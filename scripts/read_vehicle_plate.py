"""Read text from plate crops already located by the vehicle YOLO model."""
import collections
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2


def recognize(video_path, detection_path):
    data = json.loads(Path(detection_path).read_text(encoding='utf-8'))
    candidates = []
    for frame in data['frames']:
        for det in frame.get('detections', []):
            if 'box' in det and det.get('confidence', 0) >= .5:
                x1, y1, x2, y2 = det['box']
                candidates.append(((x2-x1)*(y2-y1), frame['index'], det['box']))
    candidates.sort(reverse=True)
    selected = []
    for candidate in candidates:
        if all(abs(candidate[1]-other[1]) >= 8 for other in selected):
            selected.append(candidate)
        if len(selected) == 14:
            break
    with tempfile.TemporaryDirectory(prefix='smartkoz-plate-') as folder:
        cap = cv2.VideoCapture(str(video_path))
        try:
            for i, (_, index, box) in enumerate(selected):
                cap.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, frame = cap.read()
                if not ok:
                    continue
                x1, y1, x2, y2 = map(int, box)
                padding = max(6, int((x2-x1)*.08))
                crop = frame[max(0,y1-6):y2+6, max(0,x1-padding):x2+padding]
                if crop.size:
                    scale = 110 / crop.shape[0]
                    crop = cv2.resize(crop, None, fx=scale, fy=scale)
                    cv2.imwrite(str(Path(folder)/f'{i}.png'), crop)
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                    cv2.imwrite(str(Path(folder)/f'{i}-binary.png'), binary)
            result = subprocess.run(['powershell.exe', '-NoProfile', '-File', str(Path(__file__).with_name('read_plate.ps1')), '-Folder', folder], capture_output=True, timeout=40)
            if result.returncode:
                raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
            texts = json.loads(result.stdout.decode('utf-8-sig'))
        finally:
            cap.release()
    found = collections.defaultdict(set)
    for result in texts:
        text = result['text']
        text = text.upper().translate(str.maketrans({'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X'}))
        compact = re.sub(r'[^A-Z0-9]', '', text)
        for number, letters, region in re.findall(r'(\d{3})([A-Z]{3})(\d{2})', compact):
            found[f'{number} {letters} {region}'].add(result['sample'])
    counts = collections.Counter({plate:len(samples) for plate,samples in found.items()})
    plate, votes = counts.most_common(1)[0] if counts else (None, 0)
    # Require agreement across multiple independently sampled frames.
    recognition = {'plate': plate if votes >= 2 else None, 'samples': votes, 'method': 'Windows OCR', 'texts': texts}
    data['plateRecognition'] = recognition
    target = Path(detection_path)
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    temporary.replace(target)
    print(json.dumps(recognition))


if __name__ == '__main__':
    recognize(sys.argv[1], sys.argv[2])
