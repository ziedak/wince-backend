#!/usr/bin/env python3
"""
Generate a minimal valid ONNX model for development / CI use.

The model is a simple 4-feature linear + sigmoid classifier that mimics the
interface expected by InferenceService:
  Input  — name: "features",   shape: [batch, 4], dtype: float32
            features: [cart_value, abandonment_rate_7d, is_frustrated, avg_cart_value_30d]
  Output — name: "confidence", shape: [batch, 1], dtype: float32
            value in (0, 1) representing intervention propensity

Usage (run from workspace root):
    pip install onnx numpy          # one-time
    python scripts/generate-dummy-onnx.py

Output:
    apps/decision-engine/models/dummy.onnx
"""

from __future__ import annotations

import pathlib
import sys

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
try:
    import numpy as np
    import onnx
    from onnx import TensorProto, helper
except ImportError:
    print("ERROR: required packages missing. Run: pip install onnx numpy", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Model definition
# ---------------------------------------------------------------------------
# Input: batch of 4 features
X = helper.make_tensor_value_info("features", TensorProto.FLOAT, [None, 4])
# Output: batch of 1 confidence scores
Y = helper.make_tensor_value_info("confidence", TensorProto.FLOAT, [None, 1])

# Weights [4, 1] — small positive weights so output is ~0.5 for typical inputs
W_data = np.array([[0.3], [0.4], [0.5], [0.2]], dtype=np.float32)
W_tensor = helper.make_tensor("W", TensorProto.FLOAT, [4, 1], W_data.flatten().tolist())

# Bias [1]
B_tensor = helper.make_tensor("B", TensorProto.FLOAT, [1], [-0.5])

# Graph: MatMul → Add → Sigmoid
nodes = [
    helper.make_node("MatMul", inputs=["features", "W"], outputs=["matmul_out"]),
    helper.make_node("Add",    inputs=["matmul_out", "B"], outputs=["add_out"]),
    helper.make_node("Sigmoid", inputs=["add_out"], outputs=["confidence"]),
]

graph = helper.make_graph(
    nodes,
    name="dummy-intervention-propensity",
    inputs=[X],
    outputs=[Y],
    initializer=[W_tensor, B_tensor],
)

model = helper.make_model(
    graph,
    opset_imports=[helper.make_opsetid("", 17)],
)
model.doc_string = (
    "Dummy intervention propensity model for development. "
    "Replace with a real model by setting MODEL_PATH in production."
)

# ---------------------------------------------------------------------------
# Validate & save
# ---------------------------------------------------------------------------
onnx.checker.check_model(model)

out_path = pathlib.Path("apps/decision-engine/models/dummy.onnx")
out_path.parent.mkdir(parents=True, exist_ok=True)
onnx.save(model, str(out_path))

print(f"Generated {out_path} ({out_path.stat().st_size} bytes)")
print("Input  node : 'features'   shape=[batch, 4]  dtype=float32")
print("Output node : 'confidence' shape=[batch, 1]  dtype=float32")
