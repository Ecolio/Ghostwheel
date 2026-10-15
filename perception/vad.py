"""Silero ONNX on the same browser-processed signal used by WebRTC."""
import numpy as np
import onnxruntime as ort

class Vad:
    def __init__(self, path):
        options = ort.SessionOptions()
        options.inter_op_num_threads = options.intra_op_num_threads = 1
        self.session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        self.reset()

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, 64), dtype=np.float32)
        self.speech = False
        self.silence = 0

    def process(self, pcm):
        if len(pcm) != 1024:
            return False
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32).reshape(1, 512) / 32768
        block = np.concatenate((self.context, samples), axis=1)
        probability, self.state = self.session.run(None, {
            "input": block, "state": self.state, "sr": np.array(16000, dtype=np.int64),
        })
        self.context = block[:, -64:]
        probability = float(probability.reshape(-1)[0])
        if probability >= 0.5:
            self.speech, self.silence = True, 0
        elif probability < 0.35:
            self.silence += 32
            if self.silence >= 160:
                self.speech = False
        return self.speech
