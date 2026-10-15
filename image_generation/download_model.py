"""Télécharge un snapshot Hugging Face dans le stockage local de Cornelius."""

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parent.parent
REPOSITORIES = {
    "sdxl-turbo": "stabilityai/sdxl-turbo",
    "sana-sprint-0.6b": "Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers",
    "flux2-klein-4b": "black-forest-labs/FLUX.2-klein-4B",
    "z-image-turbo": "Tongyi-MAI/Z-Image-Turbo",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, choices=tuple(REPOSITORIES))
    args = parser.parse_args()
    destination = ROOT / "models" / "image-generation" / args.model
    destination.mkdir(parents=True, exist_ok=True)
    options = {}
    if args.model == "sdxl-turbo":
        # Le dépôt contient aussi FP32, ONNX et des checkpoints monolithiques. Seule la
        # variante Diffusers FP16 (~7 Go) est nécessaire au worker Cornelius.
        options["allow_patterns"] = [
            "model_index.json",
            "scheduler/*",
            "tokenizer/*",
            "tokenizer_2/*",
            "text_encoder/config.json",
            "text_encoder/model.fp16.safetensors",
            "text_encoder_2/config.json",
            "text_encoder_2/model.fp16.safetensors",
            "unet/config.json",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/config.json",
            "vae/diffusion_pytorch_model.fp16.safetensors",
        ]
    snapshot_download(repo_id=REPOSITORIES[args.model], local_dir=destination, **options)
    (destination / ".cornelius-ready").write_text(REPOSITORIES[args.model] + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
