import numpy as np, json
rng=np.random.default_rng(7); n=800
c=[100.0]
for i in range(n-1): c.append(c[-1]*np.exp(rng.normal(0.0004,0.018)))
c=np.array(c); o=np.r_[c[0],c[:-1]]*np.exp(rng.normal(0,0.004,n))
h=np.maximum(o,c)*np.exp(np.abs(rng.normal(0,0.008,n))); l=np.minimum(o,c)*np.exp(-np.abs(rng.normal(0,0.008,n)))
v=np.round(rng.lognormal(13,0.5,n))
json.dump({"o":o.tolist(),"h":h.tolist(),"l":l.tolist(),"c":c.tolist(),"v":v.tolist()},open("bars.json","w"))
