"""Real local inference, isolated artifacts. Run with the configured Python environment."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
from ultralytics import YOLO

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='smartkoz-ai-') as temp:
    temp = Path(temp)
    cap = cv2.VideoCapture(str(root / 'outfit/manwithnooutfit.mp4'))
    ok, frame = cap.read()
    assert ok, 'Cannot decode original PPE recording'
    model = YOLO(root / 'outfit/outfitcheck.pt')
    classes = set(model.names.values())
    assert {'person', 'helmet', 'vest'} <= classes, model.names
    result = model.predict(frame, conf=0.4, verbose=False)[0]
    people = [b for b in result.boxes if model.names[int(b.cls[0])] == 'person']
    assert people, 'No person detected in original sample'
    image = temp / 'inspection.jpg'
    cv2.imwrite(str(image), frame)
    output = subprocess.check_output([sys.executable, str(root/'scripts/inspect_ppe.py'), '--model', str(root/'outfit/outfitcheck.pt'), '--image', str(image)], text=True)
    inspection = json.loads(output.strip().splitlines()[-1])
    assert isinstance(inspection['passed'], bool)
    if inspection['people'] != 1:
        assert inspection['passed'] is False
    print('PPE image:', json.dumps(inspection, ensure_ascii=True))
    first = people[0].xyxy[0].tolist()
    x1,y1,x2,y2 = [int(n) for n in first]
    cropped = temp/'single-person.jpg'
    cv2.imwrite(str(cropped), frame[max(0,y1-15):min(frame.shape[0],y2+15),max(0,x1-15):min(frame.shape[1],x2+15)])
    single = subprocess.check_output([sys.executable, str(root/'scripts/inspect_ppe.py'), '--model', str(root/'outfit/outfitcheck.pt'), '--image', str(cropped)], text=True)
    print('Single-person crop:', single.strip().splitlines()[-1])
    clip = temp/'clip.mp4'
    height,width = frame.shape[:2]
    writer = cv2.VideoWriter(str(clip),cv2.VideoWriter_fourcc(*'mp4v'),24,(width,height))
    assert writer.isOpened()
    writer.write(frame)
    for _ in range(3):
        ok, frame = cap.read()
        assert ok
        writer.write(frame)
    writer.release()
    cap.release()
    detections = temp/'detections.json'
    subprocess.run([sys.executable,str(root/'scripts/analyze_yolo_video.py'),'--model',str(root/'outfit/outfitcheck.pt'),'--video',str(clip),'--output',str(detections)],check=True)
    payload=json.loads(detections.read_text(encoding='utf-8'))
    assert payload['video']['frames']==4
    assert any(d['label']=='person' for f in payload['frames'] for d in f['detections'])
    print('Video: 4 frames decoded and analyzed; real person boxes saved')
    for model_file, video_file in [('fall/falling.pt','fall/fall.mp4'),('microdream/dreameye.pt','microdream/microsleepdriver.mp4'),('FORTRANSPORT/carsnumber.pt','FORTRANSPORT/CAR1.mp4')]:
        other=YOLO(root/model_file)
        cap=cv2.VideoCapture(str(root/video_file))
        ok,frame=cap.read()
        cap.release()
        assert ok
        result=other.predict(frame,verbose=False)[0]
        print(model_file, 'inference OK;', len(result.boxes) if result.boxes is not None else 0, 'boxes; classes:', json.dumps(other.names,ensure_ascii=True))
print('PASS: real inference on all four existing weights; image inspection and video analysis')
