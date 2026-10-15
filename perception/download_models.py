"""Download pinned, checksummed upstream models and their licenses.

The LFM vision models ship two graph sets: q4 for the CPU and fp16 for a GPU.
The default --device auto selects fp16 when ONNX Runtime exposes a supported
GPU provider, otherwise q4. --device cpu|gpu forces either variant.
--model picks which LFM variant to fetch (450m, 1.6b, 3b), defaulting to 450m; the
face/VAD models are downloaded unless --vision-only is used.
"""
import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
GPU_PROVIDERS = {
    "CUDAExecutionProvider",
    "MIGraphXExecutionProvider",
    "ROCMExecutionProvider",
    "DmlExecutionProvider",
}


def digest(path):
    """Hash in bounded chunks: the vision sidecars are hundreds of megabytes."""
    hasher = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def fetch(url, path, sha256=None, progress=None):
    """Stream one file next to its target, then verify before publishing it."""
    partial = path.with_name(path.name + ".part")
    try:
        with urlopen(url, timeout=60) as response, open(partial, "wb") as target:
            total = int(response.headers.get("Content-Length", "0")) or None
            received, last_report = 0, 0
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
                received += len(chunk)
                if progress and time.monotonic() - last_report >= 0.25:
                    progress("downloading", received, total)
                    last_report = time.monotonic()
            if total is not None and received != total:
                raise OSError("Téléchargement incomplet : " + path.name)
            if progress:
                progress("checking", received, total)
        if sha256 and digest(partial) != sha256:
            raise ValueError("Empreinte du modèle incorrecte : " + path.name)
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)


def verify_file(path, entry, progress=None):
    if path.exists() and digest(path) == entry["sha256"]:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fetch(entry["url"], path, entry["sha256"], progress)
    return True


def license_page(url):
    """Page lisible du modèle : sur Hugging Face, le dépôt plutôt que le fichier brut."""
    marker = "/resolve/"
    return url.split(marker, 1)[0] if "huggingface.co/" in url and marker in url else url


def missing_license(name, url, error):
    """La licence est un document joint : son absence ne bloque jamais un modèle vérifié."""
    print(
        "Avertissement : copie locale de la licence de " + name + " non téléchargée ("
        + str(error) + "). Le modèle est bien installé et vérifié. Licence à consulter sur "
        + license_page(url) + " et dans THIRD_PARTY_NOTICES.md.",
        file=sys.stderr,
    )


def save_license(path, name, url):
    if path.exists():
        return
    try:
        with urlopen(url, timeout=30) as response:
            path.write_bytes(response.read())
    except OSError as error:
        missing_license(name, url, error)


def verify_license(directory, url):
    save_license(directory / "LICENSE", directory.name, url)


def resolve_model_selector(requested, known_ids):
    """Valide le sélecteur LFM : retourne l'id à télécharger, ou None si inconnu
    (les modèles de base restent téléchargés dans tous les cas)."""
    if not isinstance(requested, str) or requested not in known_ids:
        print(
            "Modèle de vision inconnu : '"
            + str(requested)
            + "'. Choisissez parmi "
            + ", ".join(sorted(str(id) for id in known_ids))
            + ". Les modèles de base restent téléchargés."
        )
        return None
    return requested


def resolve_variant(device, available=None):
    """Return the graph variant for a persisted device preference."""
    if device == "cpu":
        return "cpu"
    if device == "gpu":
        return "gpu"
    if device != "auto":
        raise ValueError("Périphérique de vision inconnu : " + str(device))
    if os.getenv("CORNELIUS_VISION_PROVIDER") == "CPUExecutionProvider":
        return "cpu"
    if available is None:
        try:
            import onnxruntime as ort
            available = ort.get_available_providers()
        except (ImportError, OSError):
            available = []
    return "gpu" if GPU_PROVIDERS.intersection(available) else "cpu"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    device = parser.add_mutually_exclusive_group()
    device.add_argument(
        "--device",
        choices=("auto", "gpu", "cpu"),
        default=os.getenv("CORNELIUS_VISION_DEVICE", "auto"),
        help="Variante à installer : auto choisit le GPU s’il est pris en charge.",
    )
    device.add_argument(
        "--gpu",
        action="store_true",
        help="Alias historique de --device gpu.",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("CORNELIUS_VISION_MODEL", "450m"),
        help="Variante LFM à télécharger : 450m (défaut), 1.6b ou 3b.",
    )
    parser.add_argument("--vision-only", action="store_true", help="Installe uniquement le modèle LFM sélectionné.")
    parser.add_argument("--json", action="store_true", help="Progression JSON ligne par ligne pour l’administration.")
    args = parser.parse_args()
    selected_variant = resolve_variant("gpu" if args.gpu else args.device)
    def emit(**event):
        if args.json:
            print(json.dumps(event, ensure_ascii=True), flush=True)
        elif event.get("file"):
            print(str(event["file"]) + " : " + str(event["state"]), flush=True)
    target = ROOT / "models"
    target.mkdir(exist_ok=True)
    manifest = json.loads((ROOT / "perception" / "models.json").read_text())
    directory_models = [model for model in manifest if "files" in model or "gpuFiles" in model]
    known_ids = {model.get("id") for model in directory_models}
    if args.vision_only and args.model not in known_ids:
        parser.error("Modèle de vision inconnu.")
    args.model = resolve_model_selector(args.model, known_ids)
    for model in manifest:
        if "files" in model or "gpuFiles" in model:
            # Seul le modèle LFM sélectionné ; visages/VAD gérés plus bas.
            if args.model is None or model.get("id") != args.model:
                continue
            directory = target / model["name"]
            directory.mkdir(exist_ok=True)
            variant = "gpuFiles" if selected_variant == "gpu" else "files"
            entries = list(model.get("shared", [])) + list(model.get(variant, []))
            for index, entry in enumerate(entries):
                def progress(state, received=0, total=None):
                    emit(state=state, file=entry["name"], completed=index, files=len(entries),
                         received=received, total=total, variant=selected_variant)
                progress("checking")
                verify_file(directory / entry["name"], entry, progress)
                emit(state="checking", file=entry["name"], completed=index + 1,
                     files=len(entries), received=0, total=None, variant=selected_variant)
            verify_license(directory, model["license"])
            continue
        if args.vision_only:
            continue
        path = target / model["name"]
        if not path.exists() or digest(path) != model["sha256"]:
            fetch(model["url"], path, model["sha256"])
        save_license(target / (model["name"] + ".LICENSE"), model["name"], model["license"])
        if not args.json:
            print(model["name"] + " vérifié")

    emit(state="ready", file=None, received=0, total=None, variant=selected_variant)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
