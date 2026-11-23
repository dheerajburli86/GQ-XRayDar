# Builds tests/fixtures/indicatorReference.json. Run from a folder holding bars.json (makeIndicatorBars.py) and ours.json
# (the engine output); needs: pip install TA-Lib pandas-ta. Where a library differs from TradingView, the TradingView formula is used.
import json, numpy as np, pandas as pd, talib as T, pandas_ta as ta, warnings
warnings.filterwarnings("ignore")
b=json.load(open("bars.json")); o,h,l,c,v=[np.array(b[k],float) for k in "ohlcv"]
O=json.load(open("ours.json"))
df=pd.DataFrame({"open":o,"high":h,"low":l,"close":c,"volume":v})
R={}
R["SMA20"]=T.SMA(c,20); R["EMA20"]=T.EMA(c,20); R["WMA20"]=T.WMA(c,20); R["HMA20"]=ta.hma(df.close,length=20).values
R["DEMA20"]=T.DEMA(c,20); R["TEMA20"]=T.TEMA(c,20); R["RSI14"]=T.RSI(c,14); R["RSI14h"]=T.RSI(c,14)
m=T.MACD(c,12,26,9); R["MACD"],R["MACDs"],R["MACDh"]=m
u,mi,lo=T.BBANDS(c,20,2,2); R["BBu"],R["BBm"],R["BBl"]=u,mi,lo; R["BBp"]=(c-lo)/(u-lo)
k,d=T.STOCH(h,l,c,14,3,0,3,0); R["STOCHk"],R["STOCHd"]=k,d
k,d=T.STOCHF(h,l,c,14,3,0); R["STOCHFk"],R["STOCHFd"]=k,d
s=ta.stochrsi(df.close,length=14,rsi_length=14,k=3,d=3); R["SRSIk"],R["SRSId"]=s.iloc[:,0].values,s.iloc[:,1].values
R["ADX"]=T.ADX(h,l,c,14); R["PDI"]=T.PLUS_DI(h,l,c,14); R["MDI"]=T.MINUS_DI(h,l,c,14); R["ATR"]=T.ATR(h,l,c,14); R["ATRw"]=T.ATR(h,l,c,14)
R["OBV"]=T.OBV(c,v); R["AD"]=T.AD(h,l,c,v); R["ADOSC"]=T.ADOSC(h,l,c,v,3,10); R["CMF"]=ta.cmf(df.high,df.low,df.close,df.volume,length=20).values
R["CCI"]=T.CCI(h,l,c,20); R["WILLR"]=T.WILLR(h,l,c,14); R["MFI"]=T.MFI(h,l,c,v,14)
d,u=T.AROON(h,l,25); R["AROONu"],R["AROONd"]=u,d; R["AROONo"]=T.AROONOSC(h,l,25)
R["TRIX"]=T.TRIX(c,15); R["CMO"]=ta.cmo(df.close,length=9,talib=False).values; R["UO"]=T.ULTOSC(h,l,c,7,14,28)
p=ta.ppo(df.close,fast=12,slow=26,signal=9,talib=False); R["PPO"],R["PPOs"]=p.iloc[:,0].values,p.iloc[:,2].values
R["ROC"]=T.ROC(c,12); R["MOM"]=T.MOM(c,10); R["SAR"]=T.SAR(h,l,0.02,0.2); R["STDDEV"]=T.STDDEV(c,20,1)
R["LINREG"]=T.LINEARREG(c,14); R["LRSLOPE"]=T.LINEARREG_SLOPE(c,14)
kc=ta.kc(df.high,df.low,df.close,length=20,scalar=2,mamode="ema"); R["KCl"],R["KCm"],R["KCu"]=[kc.iloc[:,i].values for i in range(3)]
dc=ta.donchian(df.high,df.low,lower_length=20,upper_length=20); R["DCl"],R["DCm"],R["DCu"]=[dc.iloc[:,i].values for i in range(3)]
vx=ta.vortex(df.high,df.low,df.close,length=14); R["VIp"],R["VIm"]=vx.iloc[:,0].values,vx.iloc[:,1].values
R["MASS"]=ta.massi(df.high,df.low,fast=9,slow=25).values; R["COPP"]=ta.coppock(df.close,length=10,fast=11,slow=14).values
R["DPO"]=ta.dpo(df.close,length=20,centered=False).values; R["AO"]=ta.ao(df.high,df.low,fast=5,slow=34).values
t=ta.tsi(df.close,fast=13,slow=25,signal=13); R["TSI"],R["TSIs"]=t.iloc[:,0].values,t.iloc[:,1].values
R["FORCE"]=ta.efi(df.close,df.volume,length=13).values; R["EOM"]=ta.eom(df.high,df.low,df.close,df.volume,length=14,divisor=1e8).values
er=ta.eri(df.high,df.low,df.close,length=13); R["BULL"],R["BEAR"]=er.iloc[:,0].values,er.iloc[:,1].values
R["CHOP"]=ta.chop(df.high,df.low,df.close,length=14).values; R["ULCER"]=ta.ui(df.close,length=14).values
kst=ta.kst(df.close); R["KST"],R["KSTs"]=kst.iloc[:,0].values,kst.iloc[:,1].values
sp=ta.supertrend(df.high,df.low,df.close,length=10,multiplier=3.0); R["SUPERT"]=sp.iloc[:,0].values
ic=ta.ichimoku(df.high,df.low,df.close,tenkan=9,kijun=26,senkou=52)[0]; R["TENKAN"]=ic["ITS_9"].values; R["KIJUN"]=ic["IKS_26"].values
R["VOSC"]=ta.pvo(df.volume,fast=5,slow=10,signal=1).iloc[:,0].values
import math
R["KAMA"]=T.KAMA(c,10)
hl2=(h+l)/2; val=0.0; f=0.0; FI=np.full(len(c),np.nan); FT=np.full(len(c),np.nan)
for i in range(8,len(c)):
    hi,lo=hl2[i-8:i+1].max(),hl2[i-8:i+1].min(); val=0.66*((hl2[i]-lo)/(hi-lo)-0.5)+0.67*val; val=max(-0.999,min(0.999,val)); pf=f; f=0.5*math.log((1+val)/(1-val))+0.5*f; FI[i]=f; FT[i]=pf if i>8 else np.nan
R["FISH"],R["FISHt"]=FI,FT
sw=lambda x: (pd.Series(x).shift(3)+2*pd.Series(x).shift(2)+2*pd.Series(x).shift(1)+pd.Series(x))/6
rvi=sw(c-o).rolling(10).sum()/sw(h-l).rolling(10).sum(); R["RVI"],R["RVIs"]=rvi.values,sw(rvi).values
tp=(h+l+c)/3; sv=np.where(np.r_[np.nan,np.diff(tp)]>=0,v,-v).astype(float); sv[0]=np.nan
ema=lambda x,n: pd.Series(x).ewm(span=n,adjust=False).mean().values
svs=sv[1:]; k=np.r_[np.nan,T.EMA(svs,34)-T.EMA(svs,55)]; R["KVO"]=k; R["KVOs"]=np.r_[np.nan,T.EMA(k[1:],13)]
R["PVT"]=np.cumsum(np.r_[0,np.diff(c)/c[:-1]*v[1:]]); R["BOP"]=T.BOP(o,h,l,c); R["BOP14"]=T.SMA(T.BOP(o,h,l,c),14)
a22=T.ATR(h,l,c,22); R["CEl"]=pd.Series(h).rolling(22).max().values-3*a22; R["CEs"]=pd.Series(l).rolling(22).min().values+3*a22
rma=lambda x,n: ta.rma(pd.Series(x),length=n).values
R["JAW"],R["TEETH"],R["LIPS"]=rma(hl2,13),rma(hl2,8),rma(hl2,5)
# where a library's convention differs from TradingView, the TradingView formula is the reference
R["OBV"]=T.OBV(c,v)-v[0]
e12,e26=T.EMA(c,12),T.EMA(c,26); R["PPO"]=100*(e12-e26)/e26; R["PPOs"]=T.EMA(np.nan_to_num(R["PPO"],nan=0),9)
a10=T.ATR(h,l,c,10); R["KCu"]=T.EMA(c,20)+2*a10; R["KCl"]=T.EMA(c,20)-2*a10
roc=lambda n: 100*(c/np.r_[np.full(n,np.nan),c[:-n]]-1); sm=lambda x,n: pd.Series(x).rolling(n).mean().values
kk=sm(roc(10),10)+2*sm(roc(15),10)+3*sm(roc(20),10)+4*sm(roc(30),15); R["KST"],R["KSTs"]=kk,sm(kk,9)
atr=T.ATR(h,l,c,10); up=hl2-3*atr; dn=hl2+3*atr; U=up.copy(); D=dn.copy(); tr=np.ones(len(c)); st=np.full(len(c),np.nan)
for i in range(1,len(c)):
    if np.isnan(atr[i]): continue
    if not np.isnan(U[i-1]) and c[i-1]>U[i-1]: U[i]=max(up[i],U[i-1])
    if not np.isnan(D[i-1]) and c[i-1]<D[i-1]: D[i]=min(dn[i],D[i-1])
    t=tr[i-1]
    if t==-1 and c[i]>D[i-1]: t=1
    elif t==1 and c[i]<U[i-1]: t=-1
    tr[i]=t; st[i]=U[i] if t==1 else D[i]
R["SUPERT"]=st
bad=[]
for key,ref in R.items():
    ours=np.array([np.nan if x is None else x for x in O[key]],float)
    ref=np.asarray(ref,float); w=slice(-300,None)
    a,r=ours[w],ref[w]; mask=~np.isnan(a)&~np.isnan(r)
    if mask.sum()<50: print(f"{key:8s} too few ({mask.sum()})"); bad.append(key); continue
    scale=np.nanmax(np.abs(r[mask]))+1e-12
    err=np.max(np.abs(a[mask]-r[mask]))/scale
    flag="OK " if err<1e-6 else ("~  " if err<1e-3 else "BAD")
    if flag!="OK ": bad.append(key)
    print(f"{flag} {key:8s} relerr={err:.2e}  ours={a[mask][-1]:.6g} ref={r[mask][-1]:.6g}")
print("NOT OK:",bad)

fx={k:[None if np.isnan(x) else round(float(x),10) for x in np.asarray(R[k],float)[-120:]] for k in R}
json.dump({"bars":b,"ref":fx},open("fixture.json","w"))
