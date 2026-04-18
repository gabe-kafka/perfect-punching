"""
Hanson & Hanson (1968) eccentric-shear decomposition figure.

Four panels, matching the classical MacGregor/Wight/Nilson textbook style:

  (a) Moment transfer at the slab-column interface. M_u splits into
      gamma_f * M_u (flexure across the strip c2 + 3h) and
      gamma_v * M_u (eccentric shear around the critical section at d/2).
  (b) Shear stresses from V_u alone:    uniform downward arrows on the
      critical-section top perimeter.
  (c) Shear stresses from gamma_v*M_u:  linear, antisymmetric about the
      centroidal axis perpendicular to M_u.
  (d) Total = (b) + (c):                asymmetric distribution, peak on
      the far face.

Reference:
  Hanson, N. W., and Hanson, J. M. (1968). "Shear and Moment Transfer
  Between Concrete Slabs and Columns," PCA Journal, Vol. 10, No. 1.

Output: figures/hanson_hanson.pdf (vector, for LaTeX embed).
"""
from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from pathlib import Path


# --- Normalized geometry (pedagogical; not a specific design) -----------
b1 = 1.6          # critical-section side in x
b2 = 1.6          # critical-section side in y
d  = 0.55         # effective slab depth (height of critical-section prism)
c1 = 0.95         # column side in x
c2 = 0.95         # column side in y
h_slab = 0.55     # slab thickness (display)

# colors
K    = (0.05, 0.05, 0.08)
RED  = (0.80, 0.13, 0.13)
BLUE = (0.14, 0.32, 0.80)
GREEN= (0.06, 0.55, 0.32)
GREY = (0.55, 0.55, 0.60)


# --- primitives ---------------------------------------------------------
def wire_box(ax, x1, x2, y1, y2, z_bot, z_top, color=K, lw=1.0, ls='-'):
    rx = [x1, x2, x2, x1, x1]
    ry = [y1, y1, y2, y2, y1]
    ax.plot(rx, ry, [z_bot]*5, color=color, lw=lw, ls=ls)
    ax.plot(rx, ry, [z_top]*5, color=color, lw=lw, ls=ls)
    for xi, yi in [(x1,y1),(x2,y1),(x2,y2),(x1,y2)]:
        ax.plot([xi,xi],[yi,yi],[z_bot,z_top], color=color, lw=lw, ls=ls)


def solid_box(ax, x1, x2, y1, y2, z_bot, z_top,
              face=(0.80, 0.80, 0.82, 0.85), edge=K, lw=0.8):
    verts = [
        [(x1,y1,z_bot),(x2,y1,z_bot),(x2,y2,z_bot),(x1,y2,z_bot)],   # bottom
        [(x1,y1,z_top),(x2,y1,z_top),(x2,y2,z_top),(x1,y2,z_top)],   # top
        [(x1,y1,z_bot),(x2,y1,z_bot),(x2,y1,z_top),(x1,y1,z_top)],   # -y
        [(x2,y1,z_bot),(x2,y2,z_bot),(x2,y2,z_top),(x2,y1,z_top)],   # +x
        [(x2,y2,z_bot),(x1,y2,z_bot),(x1,y2,z_top),(x2,y2,z_top)],   # +y
        [(x1,y2,z_bot),(x1,y1,z_bot),(x1,y1,z_top),(x1,y2,z_top)],   # -x
    ]
    pc = Poly3DCollection(verts, facecolor=face, edgecolor=edge, linewidths=lw)
    ax.add_collection3d(pc)


def critical_section(ax, color=K, lw=0.9, ls='-'):
    wire_box(ax, -b1/2, +b1/2, -b2/2, +b2/2, 0.0, d, color, lw, ls)


def perimeter_samples(n_per_side: int = 9):
    """Midpoint samples around the top perimeter (z = d)."""
    xs = np.linspace(-b1/2, +b1/2, n_per_side + 1)
    ys = np.linspace(-b2/2, +b2/2, n_per_side + 1)
    xm = (xs[:-1] + xs[1:]) / 2
    ym = (ys[:-1] + ys[1:]) / 2
    pts = []
    for x in xm:             pts.append((x, -b2/2))
    for y in ym:             pts.append((+b1/2, y))
    for x in reversed(xm):   pts.append((x, +b2/2))
    for y in reversed(ym):   pts.append((-b1/2, y))
    return pts


def stress_arrows(ax, direct: float, moment_y: float, scale: float = 0.35):
    """Arrows at each perimeter sample, length = direct + moment_y * y."""
    for x, y in perimeter_samples():
        v = direct + moment_y * y
        dz = -v * scale   # positive stress -> arrow points down into slab
        if abs(dz) < 1e-6:
            continue
        ratio = min(0.40, max(0.18, 0.22 / max(0.05, abs(dz))))
        ax.quiver(x, y, d, 0, 0, dz, color=K, arrow_length_ratio=ratio, lw=0.9)


def mu_label(ax, color=RED, y_offset=-b2/2 - 0.35, label_y_offset=-b2/2 - 0.55):
    """Small red arrow + 'M_u' label showing the direction of the moment vector."""
    ax.quiver(-b1/3, y_offset, d + 0.5, b1*0.70, 0, 0,
              color=color, arrow_length_ratio=0.18, lw=1.5)
    ax.text(+b1/2 + 0.15, y_offset, d + 0.52, r"$M_u$",
            color=color, fontsize=10, ha='left', va='center')


def style(ax, r=1.15, z_range=(-0.5, 1.3)):
    ax.set_axis_off()
    ax.set_proj_type('ortho')
    ax.view_init(elev=22, azim=-58)
    ax.set_xlim(-r, r); ax.set_ylim(-r, r); ax.set_zlim(*z_range)
    ax.set_box_aspect((1, 1, 0.8))


# --- panel (a): physical setup ------------------------------------------
def panel_a(ax):
    slab_z_top, slab_z_bot = 0.0, -h_slab
    col_z_top, col_z_bot   = 1.15, -1.25
    S = 1.9  # slab half-extent

    # slab (wire-only, to reveal interior geometry)
    wire_box(ax, -S, +S, -S, +S, slab_z_bot, slab_z_top, lw=0.7, color=GREY)

    # column (solid-ish, light face with black edges)
    solid_box(ax, -c1/2, +c1/2, -c2/2, +c2/2, col_z_bot, col_z_top,
              face=(0.82, 0.82, 0.86, 0.90), edge=K, lw=0.9)

    # critical section at d/2 offset, through slab depth (dashed)
    wire_box(ax, -b1/2, +b1/2, -b2/2, +b2/2, slab_z_bot, slab_z_top,
             lw=0.9, ls='--', color=K)

    # effective flexure strip on the slab top (shaded band of width c2+3h_slab)
    strip_w = (c2 + 3 * h_slab) / 2
    strip_verts = [[(-S, -strip_w, slab_z_top + 0.001),
                    (+S, -strip_w, slab_z_top + 0.001),
                    (+S, +strip_w, slab_z_top + 0.001),
                    (-S, +strip_w, slab_z_top + 0.001)]]
    ax.add_collection3d(Poly3DCollection(
        strip_verts, facecolor=(BLUE[0], BLUE[1], BLUE[2], 0.15),
        edgecolor=(BLUE[0], BLUE[1], BLUE[2], 0.9), linewidths=0.8))

    # applied moment on column (double-headed straight arrow along y axis,
    # engineering vector convention = right-hand-rule for moment about y)
    mz = col_z_top * 0.65
    ax.quiver(0, -1.55, mz, 0, 2.2, 0, color=RED,
              arrow_length_ratio=0.14, lw=2.0)
    # double-arrowhead: small counter-arrow for moment-vector notation
    ax.quiver(0, -1.55, mz, 0, 0.35, 0, color=RED,
              arrow_length_ratio=0.85, lw=2.0)
    ax.text(0, 0.80, mz + 0.06, r"$M_u$", color=RED,
            fontsize=12, ha='center')

    # gamma_f * M_u : resisted by flexure across the blue strip
    ax.text(+S*0.55, 0, slab_z_top + 0.08, r"$\gamma_f M_u$",
            fontsize=10, color=BLUE, ha='center')
    ax.text(+S*0.55, 0, slab_z_top - 0.11, r"(flexure strip $c_2 + 3h$)",
            fontsize=7, color=BLUE, ha='center')

    # gamma_v * M_u : eccentric shear around the critical section
    ax.text(-b1*0.55, +b2*0.9, slab_z_top + 0.14, r"$\gamma_v M_u$",
            fontsize=10, color=GREEN)
    ax.text(-b1*0.55, +b2*0.9, slab_z_top - 0.06,
            r"(eccentric shear on critical section)",
            fontsize=7, color=GREEN)
    # arrow curving around top of critical section
    ax.quiver(-b1/2 + 0.02, +b2/2 - 0.02, slab_z_top + 0.04,
              b1*0.45, 0, 0, color=GREEN, arrow_length_ratio=0.25, lw=1.3)

    # d/2 annotation
    ax.text(+b1/2 + 0.05, -b2/2 - 0.08, slab_z_bot - 0.14, r"$d/2$",
            fontsize=8, color=K)
    ax.plot([+c1/2, +b1/2], [-b2/2, -b2/2], [slab_z_bot - 0.06]*2,
            color=K, lw=0.7)


def panel_stress(ax, direct: float, moment_y: float, title: str,
                 show_mu: bool):
    critical_section(ax)
    stress_arrows(ax, direct, moment_y)
    if show_mu:
        mu_label(ax)
    ax.set_title(title, fontsize=10, y=-0.02)


# --- figure -------------------------------------------------------------
def main(out_path: Path):
    fig = plt.figure(figsize=(11.0, 7.6))
    fig.patch.set_facecolor('white')

    gs = fig.add_gridspec(2, 3, height_ratios=[1.35, 1.0],
                          left=0.01, right=0.99, top=0.97, bottom=0.03,
                          hspace=0.02, wspace=0.00)

    # (a) top row, spans all 3 columns
    ax_a = fig.add_subplot(gs[0, :], projection='3d')
    panel_a(ax_a)
    style(ax_a, r=2.0, z_range=(-1.35, 1.35))
    ax_a.set_title(
        r"(a) Moment transfer at the slab–column interface:  "
        r"$M_u = \gamma_f M_u + \gamma_v M_u$",
        fontsize=10, y=-0.02)

    # (b) direct shear only
    ax_b = fig.add_subplot(gs[1, 0], projection='3d')
    panel_stress(ax_b, direct=1.0, moment_y=0.0,
                 title=r"(b) Shear from $V_u$ alone",
                 show_mu=False)
    style(ax_b)

    # (c) eccentric moment only
    ax_c = fig.add_subplot(gs[1, 1], projection='3d')
    panel_stress(ax_c, direct=0.0, moment_y=1.8,
                 title=r"(c) Shear from $\gamma_v M_u$ alone",
                 show_mu=True)
    style(ax_c)

    # (d) total
    ax_d = fig.add_subplot(gs[1, 2], projection='3d')
    panel_stress(ax_d, direct=1.0, moment_y=1.8,
                 title=r"(d) Total  $V_u + \gamma_v M_u$",
                 show_mu=True)
    style(ax_d)

    fig.savefig(out_path, bbox_inches='tight', pad_inches=0.12)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    out_dir = Path(__file__).parent
    main(out_dir / "hanson_hanson.pdf")
