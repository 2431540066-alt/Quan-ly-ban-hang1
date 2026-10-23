"""Forecast daily sales using baseline and Holt-Winters methods."""

import warnings
from importlib import import_module
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

warnings.filterwarnings("ignore")
app = FastAPI()


class Req(BaseModel):
    series: list[float]  # số lượng bán mỗi ngày
    days: int = 7


def ma7(s, h):
    hist, out = list(s), []
    for _ in range(h):
        v = float(np.mean(hist[-7:])) if hist else 0.0
        out.append(v)
        hist.append(v)
    return out


def holt_winters(s, h):
    holtwinters = import_module("statsmodels.tsa.holtwinters")
    ExponentialSmoothing = holtwinters.ExponentialSmoothing
    m = ExponentialSmoothing(
        np.array(s, dtype=float),
        trend="add",
        damped_trend=True,
        seasonal="add",
        seasonal_periods=7,
        initialization_method="estimated",
    ).fit()
    return [max(0.0, float(x)) for x in m.forecast(h)]


def mae(a, f):
    return float(np.mean(np.abs(np.array(a) - np.array(f))))


def mape(a, f):
    a, f = np.array(a), np.array(f)
    nz = a > 0
    if nz.any():
        return float(np.mean(np.abs((a[nz] - f[nz]) / a[nz])) * 100)
    return 0.0


def result(method, daily, low, **extra):
    return {"method": method, "lowConfidence": low, "daily": [round(x, 2) for x in daily],
            "demand": int(round(sum(daily))), **extra}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/forecast")
def forecast(r: Req):
    s, h = r.series, max(1, min(r.days, 30))
    if len(s) < 28:  # dưới 4 tuần: không đủ để học chu kỳ tuần
        return result("moving_average", ma7(s, h), True)
    test = 14
    train, actual = s[:-test], s[-test:]
    try:
        base, hw = ma7(train, test), holt_winters(train, test)
        m_base, m_hw = mae(actual, base), mae(actual, hw)
        info = {"mae": round(m_hw, 3), "mape": round(mape(actual, hw), 1),
                "baselineMae": round(m_base, 3), "baselineMape": round(mape(actual, base), 1)}
        if m_hw < m_base:  # chỉ dùng mô hình chính nếu tốt hơn mô hình cơ sở
            return result("holt_winters", holt_winters(s, h), False, **info)
        return result("moving_average", ma7(s, h), False, **info)
    except Exception:
        return result("moving_average", ma7(s, h), True)
