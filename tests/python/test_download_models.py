import sys
import io
import hashlib
import json
import tempfile
from unittest.mock import patch
import subprocess
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from download_models import resolve_model_selector, resolve_variant, fetch, verify_file, verify_license


class ModelSelectorTests(unittest.TestCase):
    ids = {"450m", "1.6b", "3b"}

    def test_cli_help_starts_without_loading_or_downloading_models(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parents[2] / "perception" / "download_models.py"), "--help"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--model", result.stdout)

    def test_known_selector_is_returned(self):
        self.assertEqual(resolve_model_selector("1.6b", self.ids), "1.6b")

    def test_unknown_selector_falls_back_to_none(self):
        self.assertIsNone(resolve_model_selector("1.66b", self.ids))
        self.assertIsNone(resolve_model_selector("", self.ids))

    def test_non_string_unknown_is_rejected(self):
        self.assertIsNone(resolve_model_selector(None, self.ids))
        self.assertIsNone(resolve_model_selector({}, self.ids))

    def test_auto_prefers_a_supported_gpu_and_falls_back_to_cpu(self):
        self.assertEqual(resolve_variant("auto", ["CUDAExecutionProvider"]), "gpu")
        self.assertEqual(resolve_variant("auto", ["CPUExecutionProvider"]), "cpu")
        self.assertEqual(resolve_variant("cpu", ["CUDAExecutionProvider"]), "cpu")
        self.assertEqual(resolve_variant("gpu", ["CPUExecutionProvider"]), "gpu")

    def test_3b_gpu_manifest_contains_every_vision_encoder_sidecar(self):
        manifest = json.loads(
            (Path(__file__).resolve().parents[2] / "perception" / "models.json").read_text(
                encoding="utf-8"
            )
        )
        model = next(entry for entry in manifest if entry.get("id") == "3b")
        names = {entry["name"] for entry in model["gpuFiles"]}
        self.assertIn("vision_encoder_fp16.onnx_data", names)
        self.assertIn("vision_encoder_fp16.onnx_data_1", names)


class DownloadIntegrityTests(unittest.TestCase):
    def response(self, data, size=None):
        response = io.BytesIO(data)
        response.headers = {"Content-Length": str(len(data) if size is None else size)}
        return response

    def test_corrupt_download_preserves_previous_model_and_removes_partial(self):
        with tempfile.TemporaryDirectory(prefix="cornelius-download-") as directory:
            target = Path(directory) / "weights.onnx"
            target.write_bytes(b"valid previous model")
            with patch("download_models.urlopen", return_value=self.response(b"corrupt")):
                with self.assertRaisesRegex(ValueError, "Empreinte"):
                    fetch("https://example.invalid/model", target, "0" * 64)
            self.assertEqual(target.read_bytes(), b"valid previous model")
            self.assertFalse(target.with_name(target.name + ".part").exists())

    def test_truncated_response_cannot_be_published(self):
        with tempfile.TemporaryDirectory(prefix="cornelius-download-") as directory:
            target = Path(directory) / "weights.onnx"
            with patch("download_models.urlopen", return_value=self.response(b"short", size=100)):
                with self.assertRaisesRegex(OSError, "incomplet"):
                    fetch("https://example.invalid/model", target)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name(target.name + ".part").exists())

    def test_verified_files_are_reused_without_network(self):
        with tempfile.TemporaryDirectory(prefix="cornelius-download-") as directory:
            target = Path(directory) / "weights.onnx"
            target.write_bytes(b"verified")
            entry = {"url": "https://example.invalid/model", "sha256": hashlib.sha256(b"verified").hexdigest()}
            with patch("download_models.urlopen") as network:
                self.assertFalse(verify_file(target, entry))
                network.assert_not_called()


class LicenseTests(unittest.TestCase):
    def test_missing_license_names_the_model_and_its_page_without_failing(self):
        url = "https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/resolve/abc/LICENSE"
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "lfm2.5-vl-450m"
            directory.mkdir()
            stderr = io.StringIO()
            with patch("download_models.urlopen", side_effect=OSError("HTTP Error 404: Not Found")), \
                    patch("sys.stderr", stderr):
                verify_license(directory, url)
            self.assertFalse((directory / "LICENSE").exists())
        message = stderr.getvalue()
        self.assertIn("lfm2.5-vl-450m", message)
        self.assertIn("bien installé", message)
        self.assertIn("https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX ", message)


if __name__ == "__main__":
    unittest.main()
