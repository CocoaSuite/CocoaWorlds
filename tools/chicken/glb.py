import json,struct,numpy as np
def load(path):
  d=open(path,'rb').read()
  clen,=struct.unpack('<I',d[12:16]); j=json.loads(d[20:20+clen])
  boff=20+clen; blen,=struct.unpack('<I',d[boff:boff+4]); b=d[boff+8:boff+8+blen]
  return j,b
def acc(j,b,i):
  a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
  n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
  dt={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8}[a['componentType']]
  off=bv.get('byteOffset',0)+a.get('byteOffset',0)
  st=bv.get('byteStride',0)
  if st and st!=n*np.dtype(dt).itemsize:
    raise Exception('strided')
  arr=np.frombuffer(b,dt,count=a['count']*n,offset=off).reshape(a['count'],n)
  if a.get('normalized'): arr=arr/np.iinfo(dt).max
  return arr
