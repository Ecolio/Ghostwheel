"""Local openWakeWord inference for the Cornelius wake-word model (models/cornelius.onnx)."""
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
        self.last_detection = 0.0
        if not self.path.is_file():
            self.detail = "Modèle absent : placez Cornelius dans models/cornelius.onnx."
            return
        mel = FEATURES / "melspectrogram.onnx"
        embedding = FEATURES / "embedding_model.onnx"
        if not mel.is_file() or not embedding.is_file():
            self.detail = "Prétraitement openWakeWord absent : installez les modèles de caractéristiques."
            return
        try:
            from openwakeword.model import Model
            self.model = Model(
                wakeword_models=[str(self.path)],
                inference_framework="onnx",
                melspec_model_path=str(mel),
                embedding_model_path=str(embedding),
            )
        except Exception as error:
            self.detail = "Modèle Cornelius illisible (" + type(error).__name__ + ")."

    def status(self):
        return {"type": "wake_status", "ready": self.model is not None, "detail": self.detail}

    def reset(self):
        self.last_detection = 0.0
        if self.model is not None:
            self.model.reset()

    def process(self, pcm):
        if self.model is None or len(pcm) != 2560:
            return None
        scores = self.model.predict(np.frombuffer(pcm, dtype="<i2"))
        score = float(next(iter(scores.values())))
        now = time.monotonic()
        if score >= self.threshold and now - self.last_detection >= 2.0:
            self.last_detection = now
            return score
        return None
