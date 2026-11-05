import argparse
import json
import os
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO


def box_detection(result, names):
    detections = []
    if result.boxes is None:
        return detections
    for box in result.boxes:
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        cls_id = int(box.cls[0])
        detections.append({
            "type": "box",
            "label": str(names.get(cls_id, cls_id)),
            "confidence": float(box.conf[0]),
            "box": [x1, y1, x2, y2],
        })
    return detections


def obb_detection(result, names):
    obb = getattr(result, "obb", None)
    if obb is None:
        return []
    detections = []
    for item in obb:
        cls_id = int(item.cls[0])
        points = [[float(x), float(y)] for x, y in item.xyxyxyxy[0].tolist()]
        detections.append({
            "type": "obb",
            "label": str(names.get(cls_id, cls_id)),
            "confidence": float(item.conf[0]),
            "points": points,
        })
    return detections


def analyze(model_path, video_path, output_path, imgsz, conf):
    model = YOLO(str(model_path))
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames = []
    index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        result = model.predict(frame, imgsz=imgsz, conf=conf, verbose=False)[0]
        detections = obb_detection(result, model.names) or box_detection(result, model.names)
        frames.append({
            "index": index,
            "time": round(index / fps, 4),
            "detections": detections,
        })
        index += 1
        if index % 25 == 0:
            print(json.dumps({"progress": index, "total": total}), flush=True)

    cap.release()
    payload = {
        "video": {
            "width": width,
            "height": height,
            "fps": fps,
            "frames": index,
            "duration": index / fps if fps else 0,
        },
        "model": {
            "path": str(model_path),
            "classes": model.names,
            "imgsz": imgsz,
            "confidence": conf,
        },
        "frames": frames,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, output_path)
    print(json.dumps({"status": "ready", "frames": index}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.25)
    args = parser.parse_args()

    analyze(
        Path(args.model).resolve(),
        Path(args.video).resolve(),
        Path(args.output).resolve(),
        args.imgsz,
        args.conf,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr, flush=True)
        raise
