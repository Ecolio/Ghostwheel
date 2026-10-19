import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from wake import WakeDetector, WakeStream


class FakeModel:
    def __init__(self):
        self.score = 0.0

    def predict(self, frame):
        assert frame.shape == (1280,)
        return {"cornelius": self.score}


class WakeStreamTest(unittest.TestCase):
    def test_threshold_cooldown_and_frame_size(self):
        stream = WakeStream(FakeModel(), 0.5)
        with patch("wake.time.monotonic", side_effect=[10.0, 10.5, 11.0, 12.6]):
            stream.model.score = 0.49
            self.assertIsNone(stream.process(bytes(2560)))
            stream.model.score = 0.8
            self.assertEqual(stream.process(bytes(2560)), 0.8)
            self.assertIsNone(stream.process(bytes(2560)))
            self.assertEqual(stream.process(bytes(2560)), 0.8)
        self.assertIsNone(stream.process(bytes(1024)))

    def test_each_stream_has_its_own_model_and_cooldown(self):
        detector = WakeDetector.__new__(WakeDetector)
        detector.threshold = 0.5
        detector.load = FakeModel
        mirror, satellite = detector.stream(), detector.stream()
        self.assertIsNot(mirror.model, satellite.model)
        mirror.model.score = satellite.model.score = 0.9
        with patch("wake.time.monotonic", side_effect=[10.0, 10.1]):
            self.assertEqual(mirror.process(bytes(2560)), 0.9)
            self.assertEqual(satellite.process(bytes(2560)), 0.9)


if __name__ == "__main__":
    unittest.main()
