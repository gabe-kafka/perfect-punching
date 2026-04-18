"""
Anchor figure for Perfect Punching whitepaper.

Matches the classical MacGregor/Nilson decomposition style: stress at the
critical section is visualized with vertical arrows whose length is
proportional to v_u at that point around the perimeter.

Panels:
  (a) Stresses from direct shear V_u alone       -> uniform arrows
  (b) Stresses from eccentric shear gamma_v*M_u  -> linear gradient (some up,
                                                    some down)
  (c) Total = (a) + (b)                          -> sum, asymmetric

Output: figures/critical_section_stress.pdf (vector, for LaTeX embed).
"""
from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path


# --- geometry (normalized units; purely illustrative) ---
b1 = 1.6    # critical-section side along x
b2 = 1.6    # critical-section side along y
d  = 0.55   # effective slab depth (prism height in the figure)


def prism_wireframe(ax, color="k", lw=1.0):
    """Critical-section shell as a wireframe rectangular tube, z in [0, d]."""
    rx = [-b1/2, +b1/2, +b1/2, -b1/2, -b1/2]
    ry = [-b2/2, -b2/2, +b2/2, +b2/2, -b2/2]
    ax.plot(rx, ry, [0.0]*5, color=color, lw=lw)
    ax.plot(rx, ry, [d]*5,   color=color, lw=lw)
    for xi, yi in [(-b1/2,-b2/2), (+b1/2,-b2/2), (+b1/2,+b2/2), (-b1/2,+b2/2)]:
        ax.plot([xi, xi], [yi, yi], [0.0, d], color=color, lw=lw)


def perimeter_samples(n_per_side: int = 9):
    """Evenly spaced points around the top-edge perimeter (z = d)."""
    pts = []
    xs = np.linspace(-b1/2, +b1/2, n_per_side + 1)
    ys = np.linspace(-b2/2, +b2/2, n_per_side + 1)
    # face y = -b2/2 (x sweeps + direction)
    for x in (xs[:-1] + xs[1:]) / 2:
        pts.append((x, -b2/2))
    # face x = +b1/2 (y sweeps + direction)
    for y in (ys[:-1] + ys[1:]) / 2:
        pts.append((+b1/2, y))
    # face y = +b2/2 (x sweeps - direction)
    for x in reversed((xs[:-1] + xs[1:]) / 2):
        pts.append((x, +b2/2))
    # face x = -b1/2 (y sweeps - direction)
    for y in reversed((ys[:-1] + ys[1:]) / 2):
        pts.append((-b1/2, y))
    return pts


def v_bar(x, y, alpha_direct, alpha_moment_y):
    """Normalized illustrative stress: uniform + linear-in-y (moment about x)."""
    return alpha_direct + alpha_moment_y * y


def draw_arrows(ax, alpha_direct: float, alpha_moment_y: float, scale: float = 0.35):
    """Vertical arrows at each perimeter sample, length proportional to v_bar."""
    for (x, y) in perimeter_samples():
        v = v_bar(x, y, alpha_direct, alpha_moment_y)
        dz = -v * scale  # positive stress -> arrow points downward into slab
        if abs(dz) < 1e-6:
            continue
        ax.quiver(
            x, y, d, 0, 0, dz,
            color="k", arrow_length_ratio=min(0.35, max(0.15, 0.25/abs(dz))),
            lw=0.85, capstyle="round",
        )


def style_axes(ax):
    ax.set_axis_off()
    ax.set_proj_type("ortho")
    ax.view_init(elev=22, azim=-58)
    # consistent framing across panels, leaves room for up/down arrows
    r = max(b1, b2) * 0.65
    ax.set_xlim(-r, r); ax.set_ylim(-r, r); ax.set_zlim(-0.45, 1.25)
    ax.set_box_aspect((1, 1, 0.8))


def draw_moment_annotation(ax):
    """Small label indicating the direction of M_u applied to the column,
    shown only for panels that include the moment contribution."""
    ax.text(+b1/2 + 0.18, -b2/2 - 0.15, d + 0.55, r"$M_u$",
            color=(0.75, 0.1, 0.1), fontsize=11, ha="left")
    # arrow indicating moment vector (curved look via short quiver in +x)
    ax.quiver(
        -b1/3, -b2/2 - 0.25, d + 0.45, b1*0.75, 0, 0,
        color=(0.75, 0.1, 0.1), arrow_length_ratio=0.18, lw=1.6,
    )


def main(out_path: Path):
    fig = plt.figure(figsize=(10.5, 3.8))
    fig.patch.set_facecolor("white")
    gs = fig.add_gridspec(1, 3, left=0.01, right=0.99, top=0.97, bottom=0.04,
                          wspace=0.0)

    # (a) direct shear alone
    ax_a = fig.add_subplot(gs[0, 0], projection="3d")
    prism_wireframe(ax_a)
    draw_arrows(ax_a, alpha_direct=1.0, alpha_moment_y=0.0)
    style_axes(ax_a)
    ax_a.set_title(r"(a) Direct shear $V_u$ alone", fontsize=10, y=-0.02)

    # (b) eccentric moment alone
    ax_b = fig.add_subplot(gs[0, 1], projection="3d")
    prism_wireframe(ax_b)
    draw_arrows(ax_b, alpha_direct=0.0, alpha_moment_y=1.8)
    draw_moment_annotation(ax_b)
    style_axes(ax_b)
    ax_b.set_title(r"(b) Eccentric shear $\gamma_v M_u$ alone",
                   fontsize=10, y=-0.02)

    # (c) total = sum
    ax_c = fig.add_subplot(gs[0, 2], projection="3d")
    prism_wireframe(ax_c)
    draw_arrows(ax_c, alpha_direct=1.0, alpha_moment_y=1.8)
    draw_moment_annotation(ax_c)
    style_axes(ax_c)
    ax_c.set_title(r"(c) Total  $V_u + \gamma_v M_u$",
                   fontsize=10, y=-0.02)

    fig.savefig(out_path, bbox_inches="tight", pad_inches=0.1)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    out_dir = Path(__file__).parent
    main(out_dir / "critical_section_stress.pdf")
