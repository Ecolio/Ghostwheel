import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from wake import WakeDetector


class FakeModel:
    def __init__(self):
        self.score = 0.0
        self.resets = 0

    def predict(self, frame):
        assert frame.shape == (1280,)
        return {"cornelius": self.score}

    def reset(self):
        self.resets += 1


class WakeDetectorTest(unittest.TestCase):
    def test_threshold_cooldown_and_frame_size(self):
        detector = WakeDetector.__new__(WakeDetector)
        detector.model = FakeModel()
        detector.threshold = 0.5
        detector.last_detection = 0.0
        with patch("wake.time.monotonic", side_effect=[10.0, 10.5, 11.0, 12.6]):
            detector.model.score = 0.49
            self.assertIsNone(detector.process(bytes(2560)))
            detector.model.score = 0.8
            self.assertEqual(detector.process(bytes(2560)), 0.8)
            self.assertIsNone(detector.process(bytes(2560)))
            self.assertEqual(detector.process(bytes(2560)), 0.8)
        self.assertIsNone(detector.process(bytes(1024)))
        detector.reset()
        self.assertEqual(detector.model.resets, 1)


if __name__ == "__main__":
    unittest.main()
