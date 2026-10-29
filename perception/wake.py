"""Local openWakeWord inference for the Ghostwheel wake-word model (models/cornelius.onnx)."""
import os
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ROOT / "models" / "openwakeword"


class WakeDetector:
    def __init__(self):
        configured = os.getenv("CORNELIUS_WAKE_MODEL", "models/cornelius.onnx")
        self.path = Path(configured)
        if not self.path.is_absolute():
            self.path = ROOT / self.path
        try:
            self.threshold = float(os.getenv("CORNELIUS_WAKE_THRESHOLD", "0.5"))
        except ValueError:
            self.threshold = 0.5
        if not 0 < self.threshold < 1:
            self.threshold = 0.5
        self.model = None
        self.detail = None
        self.mel = FEATURES / "melspectrogram.onnx"
        self.embedding = FEATURES / "embedding_model.onnx"
        if not self.path.is_file():
            self.detail = "Modèle du mot d’appel absent : vérifiez models/cornelius.onnx."
            return
        if not self.mel.is_file() or not self.embedding.is_file():
            self.detail = "Prétraitement openWakeWord absent : installez les modèles de caractéristiques."
            return
        try:
            self.model = self.load()
        except Exception as error:
            self.detail = "Modèle du mot d’appel illisible (" + type(error).__name__ + ")."

    def load(self):
        from openwakeword.model import Model
        return Model(
            wakeword_models=[str(self.path)],
            inference_framework="onnx",
            melspec_model_path=str(self.mel),
            embedding_model_path=str(self.embedding),
        )

    def status(self):
        return {"type": "wake_status", "ready": self.model is not None, "detail": self.detail}

    def stream(self):
        """A listening stream (the mirror or a satellite) with its own audio features."""
        return WakeStream(self.load(), self.threshold)


class WakeStream:
    def __init__(self, model, threshold):
        self.model = model
        self.threshold = threshold
        self.last_detection = 0.0

    def process(self, pcm):
        if len(pcm) != 2560:
            return None
        scores = self.model.predict(np.frombuffer(pcm, dtype="<i2"))
        score = float(next(iter(scores.values())))
        now = time.monotonic()
        if score >= self.threshold and now - self.last_detection >= 2.0:
            self.last_detection = now
            return score
        return None
