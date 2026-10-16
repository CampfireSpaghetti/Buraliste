"""Génère tests/fixtures/ean13-3017620422003.mjpeg : un flux caméra simulé montrant un code EAN-13."""
from PIL import Image, ImageDraw
import io

L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

def ean13_bits(code):
    d = [int(c) for c in code]
    bits = '101'
    for i, p in enumerate(PARITY[d[0]]):
        bits += (L if p == 'L' else G)[d[1 + i]]
    bits += '01010'
    for x in d[7:]:
        bits += R[x]
    return bits + '101'

def frame(code, w=640, h=480, module=4):
    im = Image.new('L', (w, h), 255)
    dr = ImageDraw.Draw(im)
    bits = ean13_bits(code)
    x0 = (w - len(bits) * module) // 2
    for i, b in enumerate(bits):
        if b == '1':
            dr.rectangle([x0 + i * module, 140, x0 + (i + 1) * module - 1, 340], fill=0)
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=92)
    return buf.getvalue()

if __name__ == '__main__':
    data = frame('3017620422003')
    with open('tests/fixtures/ean13-3017620422003.mjpeg', 'wb') as f:
        for _ in range(3):
            f.write(data)
