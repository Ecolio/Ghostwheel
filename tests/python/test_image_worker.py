import asyncio
import importlib.util
import json
import sys
import threading
import unittest
from pathlib import Path

# Nom distinct : le worker de perception s’appelle aussi « worker ».
_spec = importlib.util.spec_from_file_location(
    "image_worker", Path(__file__).resolve().parents[2] / "image_generation" / "worker.py"
)
worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(worker)


def request(request_id):
    return json.dumps({
        "type": "generate", "requestId": request_id, "prompt": "un phare", "model": "sdxl-turbo",
        "width": 512, "height": 512, "output": "data/generated-images/x.webp", "seed": None,
    })


class Socket:
    """Messages du serveur, lus pendant que le faux générateur travaille."""

    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []

    async def send(self, payload):
        self.sent.append(json.loads(payload))

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.incoming.get()
        if message is None:
            raise StopAsyncIteration
        return message

    def results(self):
        return [event for event in self.sent if event["type"] in ("result", "error")]


class Generator:
    def __init__(self):
        self.model, self.pipe, self.device = None, None, "cpu"
        self.started = []
        self.loaded = []
        self.stops = []

    def load(self, model):
        self.loaded.append(model)
        self.model, self.pipe = model, object()

    def generate(self, event, stop):
        self.started.append(event["requestId"])
        self.stops.append(stop)
        if event["requestId"] == "lente":
            # Une génération longue s’arrête à l’étape suivante quand le serveur l’annule.
            if stop.wait(5):
                raise worker.GenerationCancelled()
        return 7


class ServeTests(unittest.IsolatedAsyncioTestCase):
    async def wait_for(self, condition):
        for _ in range(200):
            if condition():
                return
            await asyncio.sleep(0.01)
        self.fail("condition non atteinte")

    async def test_a_new_request_interrupts_the_current_one_and_skips_cancelled_ones(self):
        socket, generator = Socket(), Generator()
        served = asyncio.create_task(worker.serve(socket, generator))
        await socket.incoming.put(request("lente"))
        await self.wait_for(lambda: generator.started == ["lente"])
        # Le serveur annule l’image en cours puis une demande déjà remplacée, et en envoie une nouvelle.
        await socket.incoming.put(request("remplacee"))
        await socket.incoming.put(json.dumps({"type": "cancel", "requestId": "remplacee"}))
        await socket.incoming.put(json.dumps({"type": "cancel", "requestId": "lente"}))
        await socket.incoming.put(request("nouvelle"))
        await self.wait_for(lambda: len(socket.results()) == 1)
        self.assertEqual(generator.started, ["lente", "nouvelle"])
        self.assertEqual(socket.results()[0]["requestId"], "nouvelle")
        self.assertEqual(socket.results()[0]["type"], "result")
        await socket.incoming.put(None)
        await served

    async def test_configure_preloads_the_model_once_only_when_asked(self):
        socket, generator = Socket(), Generator()
        served = asyncio.create_task(worker.serve(socket, generator))
        await socket.incoming.put(json.dumps({"type": "configure", "model": "sdxl-turbo"}))
        await socket.incoming.put(
            json.dumps({"type": "configure", "model": "sdxl-turbo", "preload": True})
        )
        await socket.incoming.put(
            json.dumps({"type": "configure", "model": "sdxl-turbo", "preload": True})
        )
        await socket.incoming.put(json.dumps({"type": "configure", "model": "inconnu", "preload": True}))
        await self.wait_for(lambda: any("préchargé" in str(e.get("detail")) for e in socket.sent))
        await socket.incoming.put(None)
        await served
        self.assertEqual(generator.loaded, ["sdxl-turbo"])

    async def test_a_disconnection_interrupts_the_running_generation(self):
        socket, generator = Socket(), Generator()
        served = asyncio.create_task(worker.serve(socket, generator))
        await socket.incoming.put(request("lente"))
        await self.wait_for(lambda: generator.started == ["lente"])
        await socket.incoming.put(None)
        await served
        self.assertTrue(generator.stops[0].is_set())



class Weights:
    """Composant factice : des paramètres dont seule la taille compte."""

    class Tensor:
        def __init__(self, count, size):
            self.count, self.size = count, size

        def numel(self):
            return self.count

        def element_size(self):
            return self.size

    def __init__(self, *sizes):
        self.sizes = sizes

    def parameters(self):
        return [self.Tensor(count, 2) for count in self.sizes]

    def buffers(self):
        return []


class Pipeline:
    def __init__(self, **components):
        self.components = components


class PlacementTest(unittest.TestCase):
    def test_weights_are_counted_in_their_compute_type(self):
        pipe = Pipeline(transformer=Weights(6_000_000_000), text_encoder=Weights(4_000_000_000),
                        scheduler=object(), tokenizer=object())
        self.assertEqual(worker.pipeline_bytes(pipe), 20_000_000_000)

    def test_z_image_beside_the_vision_model_uses_fp8_then_offload_never_spilling(self):
        # 4090 : 24 Go, dont environ 8,5 Go déjà pris (LFM 3B sur GPU, bureau, navigateur).
        weights, free = int(19.4 * worker.GIB), int(15.5 * worker.GIB)
        # Transformer (11,5 Go) et Qwen3 (7,5 Go) en FP8 : économie comptée à 45 %.
        fp8 = weights - int((11.5 + 7.5) * worker.GIB * 0.45)
        self.assertEqual(worker.choose_placement("auto", weights, free, fp8), "fp8")
        self.assertEqual(worker.choose_placement("auto", weights, free), "offload")
        self.assertEqual(worker.choose_placement("auto", weights, int(10 * worker.GIB), fp8), "offload")
        self.assertEqual(worker.choose_placement("auto", weights, int(23.5 * worker.GIB), fp8), "gpu")

    def test_the_environment_can_force_either_placement(self):
        self.assertEqual(worker.choose_placement("1", 1, 100 * worker.GIB), "offload")
        self.assertEqual(worker.choose_placement("0", 100 * worker.GIB, 1), "gpu")
        self.assertEqual(worker.choose_placement("auto", 100 * worker.GIB, None), "gpu")

    def test_shared_memory_budget_can_replace_the_detected_vram(self):
        # Ryzen AI : ROCm peut ne voir que la réserve du BIOS ; la mémoire partagée est plus large.
        from unittest import mock

        with mock.patch.dict(worker.os.environ, {"CORNELIUS_IMAGE_VRAM_GB": "14,5"}):
            self.assertEqual(worker.vram_budget(512 * 1024 ** 2), int(14.5 * worker.GIB))
        for value in ("", "zéro", "-3"):
            with mock.patch.dict(worker.os.environ, {"CORNELIUS_IMAGE_VRAM_GB": value}):
                self.assertEqual(worker.vram_budget(123), 123)

    def test_the_float32_transformer_is_detected_and_copied_once_in_bf16(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "transformer"
            folder.mkdir()
            def shard(name, dtype):
                header = json.dumps({"poids": {"dtype": dtype, "shape": [1], "data_offsets": [0, 4]}})
                (folder / name).write_bytes(len(header).to_bytes(8, "little") + header.encode() + bytes(4))
            shard("model-00001.safetensors", "F32")
            self.assertTrue(worker.stored_float32(folder))
            shard("model-00001.safetensors", "BF16")
            self.assertFalse(worker.stored_float32(folder))
            self.assertFalse(worker.stored_float32(Path(directory) / "absent"))

            class Transformer:
                def save_pretrained(self, target, **options):
                    Path(target).mkdir(parents=True)
                    (Path(target) / "config.json").write_text("{}")
                    self.options = options

            target = Path(directory) / worker.BF16_DIRECTORY
            transformer = Transformer()
            worker.save_bf16_copy(transformer, target)
            self.assertTrue((target / worker.BF16_READY).exists())
            self.assertTrue((target / "config.json").exists())
            self.assertFalse(target.with_name(target.name + ".tmp").exists())
            self.assertTrue(transformer.options["safe_serialization"])

    def test_status_names_the_placement(self):
        generator = worker.Generator("cuda")
        generator.placement = "entièrement en VRAM (19,4 Go)"
        self.assertEqual(generator.ready_detail(), "Modèle prêt · entièrement en VRAM (19,4 Go).")
        self.assertEqual(worker.gigabytes(int(15.5 * worker.GIB)), "15,5 Go")

if __name__ == "__main__":
    unittest.main()
