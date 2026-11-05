"""One persistent YOLO model, JSONL IPC; JPEGs live only in memory."""
import argparse
import base64
import contextlib
import json
import sys
import time

def emit(value):
    print(json.dumps(value), flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--model',required=True)
    args=parser.parse_args()
    # Keep third-party logs out of the machine-readable stdout channel.
    with contextlib.redirect_stdout(sys.stderr):
        import cv2
        import numpy as np
        from ultralytics import YOLO
        from analyze_yolo_video import box_detection
        model=YOLO(args.model)
        model.predict(np.zeros((384,640,3),dtype=np.uint8),imgsz=640,verbose=False)
    mapping={
        'eyeLeftOpen':('left','OPEN'),'eyeRightOpen':('right','OPEN'),
        'eyeLeftClose':('left','CLOSED'),'eyeRightClose':('right','CLOSED'),
        'eyeLeftSquint':('left','UNCERTAIN'),'eyeRightSquint':('right','UNCERTAIN'),
    }
    supported={name:mapping[name] for name in model.names.values() if name in mapping}
    if not {'eyeLeftOpen','eyeRightOpen','eyeLeftClose','eyeRightClose'} <= set(supported):
        raise RuntimeError('Model does not expose the required left/right open/closed eye classes: '+str(model.names))
    emit({'type':'ready','classes':model.names,'mapping':supported})
    for line in sys.stdin:
        request=json.loads(line)
        try:
            started=time.perf_counter()
            raw=base64.b64decode(request['image'],validate=True)
            frame=cv2.imdecode(np.frombuffer(raw,dtype=np.uint8),cv2.IMREAD_COLOR)
            if frame is None or max(frame.shape[:2])>1280:
                raise ValueError('Invalid JPEG or dimensions above 1280px')
            with contextlib.redirect_stdout(sys.stderr):
                result=model.predict(frame,imgsz=640,conf=0.5,agnostic_nms=True,verbose=False)[0]
            detections=box_detection(result,model.names)
            eyes=[]
            for d in detections:
                if d['label'] in supported:
                    side,state=supported[d['label']]
                    d['eye_side']=side
                    d['eye_state']=state
                    eyes.append(d)
            states=[d['eye_state'] for d in eyes]
            # A wink, squint, or only one closed eye is not evidence of both eyes closed.
            eye_state='CLOSED' if len(states)==2 and all(s=='CLOSED' for s in states) else 'OPEN' if 1<=len(states)<=2 and all(s=='OPEN' for s in states) else 'UNKNOWN'
            emit({'type':'result','id':request['id'],'width':frame.shape[1],'height':frame.shape[0],
                  'eye_state':eye_state,'eyes_visible':bool(eyes),'confidence':min([d['confidence'] for d in eyes],default=None),
                  'detections':detections,'inference_ms':round((time.perf_counter()-started)*1000,1)})
        except Exception as error:
            emit({'type':'error','id':request.get('id'),'error':str(error)})

if __name__=='__main__':
    try:
        main()
    except Exception as error:
        emit({'type':'fatal','error':str(error)})
        sys.exit(1)
