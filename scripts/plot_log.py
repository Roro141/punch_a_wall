"""Plot a Punch Wall session log.

Record a log in the app with L (press L again to stop and download it), then:

    pip install matplotlib
    python scripts/plot_log.py punch-log-2026-10-21T14-03-22.json

Saves a PNG next to the log (or wherever -o says) with:
  - growth rate per hand, the STRIKE_RATE threshold, and every detected hit
  - the state machine's state over time
  - fist score per hand with the FIST_ON / FIST_OFF thresholds
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

STATES = ["IDLE", "FIST_READY", "STRIKING", "HIT", "COOLDOWN"]
HIT_COLORS = {"strike": "#d62728", "vanish": "#ff7f0e", "click": "#7f7f7f"}
NAN = float("nan")


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != "punch-wall-log":
        sys.exit(f"{path} doesn't look like a Punch Wall log")
    if not data.get("frames"):
        sys.exit(f"{path} has no frames - was the camera running while you recorded?")
    return data


def series(frames: list[dict], hand_id: str, key: str) -> list[float]:
    """One value per frame for this hand, NaN where the hand wasn't tracked (breaks the line)."""
    out = []
    for frame in frames:
        hand = next((h for h in frame["hands"] if h["id"] == hand_id), None)
        if hand is None:
            out.append(NAN)
        elif key == "state":
            out.append(STATES.index(hand["state"]) if hand["state"] in STATES else NAN)
        else:
            out.append(hand[key])
    return out


def plot(data: dict, only_hand: str | None) -> plt.Figure:
    frames = data["frames"]
    hits = data.get("hits", [])
    t = [f["t"] / 1000 for f in frames]
    strike = [f["th"][0] for f in frames]
    fist_on = [f["th"][1] for f in frames]
    fist_off = [f["th"][2] for f in frames]

    hand_ids = sorted({h["id"] for f in frames for h in f["hands"]})
    if only_hand:
        if only_hand not in hand_ids:
            sys.exit(f"no hand called {only_hand!r} in this log (found: {', '.join(hand_ids) or 'none'})")
        hand_ids = [only_hand]
        hits = [h for h in hits if h["hand"] in (only_hand, "mouse")]

    fig, (ax_g, ax_s, ax_f) = plt.subplots(
        3, 1, figsize=(14, 8), sharex=True, gridspec_kw={"height_ratios": [3, 1, 2]}
    )

    # growth + STRIKE_RATE + hits
    for hand_id in hand_ids:
        ax_g.plot(t, series(frames, hand_id, "growth"), lw=1.2, label=f"growth ({hand_id})")
    ax_g.step(t, strike, where="post", color="#d62728", ls="--", lw=1, label="STRIKE_RATE")
    ax_g.axhline(0, color="#999", lw=0.6)
    for kind, color in HIT_COLORS.items():
        these = [h for h in hits if h["reason"] == kind]
        for h in these:
            for ax in (ax_g, ax_s, ax_f):
                ax.axvline(h["t"] / 1000, color=color, lw=1, alpha=0.5)
        peaks = [h for h in these if kind != "click"]
        if peaks:
            ax_g.scatter(
                [h["t"] / 1000 for h in peaks],
                [h["peak"] for h in peaks],
                color=color,
                zorder=3,
                s=24,
                label=f"hit: {kind} ({len(these)})",
            )
        elif these:
            ax_g.plot([], [], color=color, label=f"hit: {kind} ({len(these)})")
    ax_g.set_ylabel("growth rate (/s)")
    ax_g.legend(loc="upper right", fontsize=8, ncol=2)
    ax_g.grid(alpha=0.25)

    # state machine
    for hand_id in hand_ids:
        ax_s.step(t, series(frames, hand_id, "state"), where="post", lw=1.2, label=hand_id)
    ax_s.set_yticks(range(len(STATES)), STATES, fontsize=7)
    ax_s.set_ylim(-0.5, len(STATES) - 0.5)
    ax_s.grid(alpha=0.25)

    # fist score + thresholds
    for hand_id in hand_ids:
        ax_f.plot(t, series(frames, hand_id, "fist"), lw=1.2, label=f"fist ({hand_id})")
    ax_f.step(t, fist_on, where="post", color="#2ca02c", ls="--", lw=1, label="FIST_ON")
    ax_f.step(t, fist_off, where="post", color="#9467bd", ls="--", lw=1, label="FIST_OFF")
    ax_f.set_ylim(-0.05, 1.05)
    ax_f.set_ylabel("fist score")
    ax_f.set_xlabel("time (s)")
    ax_f.legend(loc="upper right", fontsize=8, ncol=3)
    ax_f.grid(alpha=0.25)

    tracked = sum(1 for f in frames if f["hands"])
    fps = len(frames) / (frames[-1]["t"] / 1000) if frames[-1]["t"] > 0 else math.nan
    counts = ", ".join(f"{k} {sum(1 for h in hits if h['reason'] == k)}" for k in HIT_COLORS)
    fig.suptitle(
        f"{data.get('startedAt', '')}   {len(frames)} frames (~{fps:.0f} fps), "
        f"hand tracked in {tracked / len(frames):.0%}   hits: {counts}",
        fontsize=10,
    )
    fig.tight_layout()
    return fig


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log", type=Path, help="punch-log-*.json downloaded from the app")
    parser.add_argument("-o", "--out", type=Path, help="output PNG (default: next to the log)")
    parser.add_argument("--hand", help="only plot this hand, e.g. Right")
    args = parser.parse_args()

    fig = plot(load(args.log), args.hand)
    out = args.out or args.log.with_suffix(".png")
    fig.savefig(out, dpi=130)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
