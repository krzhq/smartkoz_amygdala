"""Single-person PPE inspection. No identity inference or synthetic success."""
import argparse
import json
from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument('--image', required=True)
parser.add_argument('--model', required=True)
args = parser.parse_args()
model = YOLO(args.model)
result = model.predict(args.image, conf=0.4, verbose=False)[0]
items = [(model.names[int(b.cls[0])].lower(), [float(n) for n in b.xyxy[0].tolist()]) for b in result.boxes]
people = [box for label, box in items if label == 'person']
helmet = vest = False
if len(people) == 1:
    x1, y1, x2, y2 = people[0]
    def inside(box, top, bottom):
        cx, cy = (box[0]+box[2])/2, (box[1]+box[3])/2
        return x1 <= cx <= x2 and y1+(y2-y1)*top <= cy <= y1+(y2-y1)*bottom
    helmet = any(label == 'helmet' and inside(box, 0, 0.4) for label, box in items)
    vest = any(label == 'vest' and inside(box, 0.2, 0.85) for label, box in items)
print(json.dumps({'helmet': helmet, 'vest': vest, 'passed': len(people) == 1 and helmet and vest,
                  'people': len(people), 'classes': model.names, 'note': 'Exactly one person required; helmet and vest associated by position.'}))
