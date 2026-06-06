#!/usr/bin/env python3
"""
Imitation learning bot trainer for Operação Atlântico Sul.

Reads JSONL game logs from data/game-logs/ and trains two networks:

  move_net   — given a unit's features + game context, predict movement
               direction (0=stay, 1-6=hex direction).  Exported as
               ml/models/move_net.onnx  [input: [B,26]  output: [B,7]]

  attack_net — given an (attacker, target) feature pair, predict whether
               to attack (probability 0-1).  Exported as
               ml/models/attack_net.onnx [input: [B,24]  output: [B,1]]

Usage:
    python ml/train_bot.py [--epochs N] [--lr LR]
"""

import argparse
import glob
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).parent.parent
LOG_DIR  = ROOT / "data" / "game-logs"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# ─── Hex math (mirrors server.js) ─────────────────────────────────────────────
GRID_W, GRID_H = 16, 10
TERRAIN_MAP = [
    [0,0,0,0,0,0,1,2,3,3,3,3,3,3,3,3],
    [0,0,0,0,0,1,1,2,3,3,3,3,3,3,3,3],
    [0,0,0,0,1,1,2,4,3,3,3,3,3,3,3,3],
    [0,0,0,1,1,2,4,4,3,3,3,3,3,3,3,3],
    [0,0,1,1,2,4,4,2,3,3,3,3,3,3,3,3],
    [0,1,1,2,4,4,2,3,3,3,3,3,3,3,3,3],
    [1,1,2,4,4,2,3,3,3,3,3,3,3,3,3,3],
    [1,2,2,4,2,2,3,3,3,3,3,3,3,3,3,3],
    [1,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
    [1,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3],
]
CUBE_DIRS = [(+1,-1,0),(+1,0,-1),(0,+1,-1),(-1,+1,0),(-1,0,+1),(0,-1,+1)]


def get_terrain(col, row):
    if col < 0 or col >= GRID_W or row < 0 or row >= GRID_H:
        return 0
    return TERRAIN_MAP[row][col]


def oddq_to_cube(col, row):
    x = col
    z = row - (col - (col & 1)) // 2
    return (x, -x - z, z)


def hex_dist(c1, r1, c2, r2):
    a = oddq_to_cube(c1, r1)
    b = oddq_to_cube(c2, r2)
    return max(abs(a[0]-b[0]), abs(a[1]-b[1]), abs(a[2]-b[2]))


def get_move_dir(from_col, from_row, to_col, to_row):
    """Return 0=stay, 1-6=closest cube direction."""
    if from_col == to_col and from_row == to_row:
        return 0
    fa = oddq_to_cube(from_col, from_row)
    ta = oddq_to_cube(to_col, to_row)
    dx, dy, dz = ta[0]-fa[0], ta[1]-fa[1], ta[2]-fa[2]
    length = max(abs(dx), abs(dy), abs(dz))
    if length == 0:
        return 0
    dx_n, dy_n, dz_n = dx/length, dy/length, dz/length
    best_d, best_i = float('inf'), 0
    for i, (cx, cy, cz) in enumerate(CUBE_DIRS):
        d = (dx_n-cx)**2 + (dy_n-cy)**2 + (dz_n-cz)**2
        if d < best_d:
            best_d, best_i = d, i
    return best_i + 1  # 1-6


# ─── Feature dimensions ────────────────────────────────────────────────────────
# move_features:   10(unit) + 4(nearest enemy) + 2(nearest ally) + 4(context) + 6(weapons) = 26
# attack_features: 10(attacker) + 10(target) + 4(pair) = 24
MOVE_FEAT_DIM   = 26
ATTACK_FEAT_DIM = 24
MOVE_CLASSES    = 7   # 0=stay, 1-6=hex direction


# ─── Feature extraction ────────────────────────────────────────────────────────
def _unit_base(u):
    """10 normalized features for a single unit."""
    col  = u.get('col', 0)
    row  = u.get('row', 0)
    hp   = u.get('hp', 0)
    mhp  = u.get('maxHp', 1) or 1
    mov  = u.get('movement', 0)
    cat  = u.get('category', 'surface')
    fuel = u.get('fuel') or {}
    fp_c = fuel.get('current', 1)
    fp_m = fuel.get('max', 1) or 1
    uses = fuel.get('usesFuel', False)
    return [
        col / (GRID_W - 1),
        row / (GRID_H - 1),
        hp / mhp,
        (fp_c / fp_m) if uses else 1.0,
        mov / 6.0,
        get_terrain(col, row) / 4.0,
        float(cat == 'surface'),
        float(cat == 'submarine'),
        float(cat == 'air'),
        float(cat == 'land'),
    ]


def move_features(unit, allies, enemies, turn, period):
    """26-dimensional feature vector for move_net."""
    feats = _unit_base(unit)                   # 10

    col, row = unit['col'], unit['row']
    live_en = [e for e in enemies if e.get('hp', 0) > 0]

    if live_en:
        dists   = [hex_dist(col, row, e['col'], e['row']) for e in live_en]
        near    = live_en[int(np.argmin(dists))]
        feats  += [min(dists)/15.0,
                   near['col']/(GRID_W-1),
                   near['row']/(GRID_H-1),
                   get_terrain(near['col'], near['row'])/4.0]
    else:
        feats  += [1.0, 0.5, 0.5, 0.5]        # 4

    live_al = [a for a in allies if a.get('hp', 0) > 0 and a.get('id') != unit.get('id')]
    if live_al:
        dists  = [hex_dist(col, row, a['col'], a['row']) for a in live_al]
        feats += [min(dists)/15.0, len(live_al)/20.0]
    else:
        feats += [1.0, 0.0]                    # 2

    feats += [
        turn / 20.0,
        float(period == 'night'),
        len(live_en) / 20.0,
        col / (GRID_W - 1),
    ]                                           # 4

    weapons = unit.get('weapons', {})
    total   = sum(w.get('quantity', 0) for w in weapons.values())
    feats  += [
        min(total, 20) / 20.0,
        float(weapons.get('ascm',       {}).get('quantity', 0) > 0),
        float(weapons.get('torpedo',    {}).get('quantity', 0) > 0),
        float(weapons.get('airDefense', {}).get('quantity', 0) > 0),
        float(weapons.get('lacm',       {}).get('quantity', 0) > 0),
        float(weapons.get('navalGun',   {}).get('quantity', 0) > 0),
    ]                                           # 6

    assert len(feats) == MOVE_FEAT_DIM, f"Expected {MOVE_FEAT_DIM}, got {len(feats)}"
    return feats


def attack_features(attacker, target, dist, turn, period):
    """24-dimensional feature vector for attack_net."""
    feats  = _unit_base(attacker)              # 10
    feats += _unit_base(target)                # 10
    feats += [
        dist / 15.0,
        float(period == 'night'),
        turn / 20.0,
        float(target.get('detected', True)),
    ]                                          # 4
    assert len(feats) == ATTACK_FEAT_DIM
    return feats


# ─── Log parsing ──────────────────────────────────────────────────────────────
def load_games(log_dir: Path):
    """
    Parse all JSONL files and return training examples.

    Returns:
        move_X, move_y   — float32 arrays for move_net
        atk_X,  atk_y   — float32 arrays for attack_net
        n_files, n_complete
    """
    move_X, move_y = [], []
    atk_X,  atk_y = [], []
    n_files, n_complete = 0, 0

    for fpath in sorted(glob.glob(str(log_dir / "*.jsonl"))):
        events = []
        try:
            with open(fpath) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        events.append(json.loads(line))
        except Exception as e:
            print(f"  Warning: skipping {Path(fpath).name}: {e}")
            continue

        if not events:
            continue

        n_files += 1
        if any(e.get('event') == 'game_over' for e in events):
            n_complete += 1

        for ev in events:
            etype = ev.get('event')
            units  = ev.get('units', [])
            turn   = ev.get('turn', 1)
            period = ev.get('period', 'day')

            # ── move examples ──────────────────────────────────────────────
            if etype == 'movement_committed':
                team   = ev.get('team')
                moves  = ev.get('moves', [])
                move_map = {}
                for m in moves:
                    uid = m.get('unitId')
                    to  = m.get('to')
                    if uid and to:
                        move_map[uid] = to

                my_units = [u for u in units if u.get('team') == team and u.get('hp', 0) > 0]
                enemies  = [u for u in units
                            if u.get('team') not in (team, 'neutral') and u.get('hp', 0) > 0]

                for unit in my_units:
                    uid = unit['id']
                    to  = move_map.get(uid)
                    if to:
                        label = get_move_dir(unit['col'], unit['row'], to['col'], to['row'])
                    else:
                        label = 0  # stayed
                    feats = move_features(unit, my_units, enemies, turn, period)
                    move_X.append(feats)
                    move_y.append(label)

            # ── attack examples ────────────────────────────────────────────
            elif etype == 'attacks_declared':
                unit_map = {u['id']: u for u in units}
                for team in ('blue', 'red'):
                    attacks  = ev.get(f'{team}Attacks') or []
                    pos_set  = {(a['attackerId'], a['targetId']) for a in attacks}
                    my_units = [u for u in units if u.get('team') == team and u.get('hp', 0) > 0]
                    enemies  = [u for u in units
                                if u.get('team') not in (team, 'neutral') and u.get('hp', 0) > 0]

                    # Positive examples (actual attacks)
                    for atk in attacks:
                        att = unit_map.get(atk.get('attackerId'))
                        tgt = unit_map.get(atk.get('targetId'))
                        if att and tgt:
                            d = hex_dist(att['col'], att['row'], tgt['col'], tgt['row'])
                            atk_X.append(attack_features(att, tgt, d, turn, period))
                            atk_y.append(1)

                    # Negative examples (pairs NOT attacked, capped to avoid explosion)
                    for att in my_units[:6]:
                        for tgt in enemies[:6]:
                            if (att['id'], tgt['id']) not in pos_set:
                                d = hex_dist(att['col'], att['row'], tgt['col'], tgt['row'])
                                atk_X.append(attack_features(att, tgt, d, turn, period))
                                atk_y.append(0)

    move_X = np.array(move_X, dtype=np.float32) if move_X else np.zeros((0, MOVE_FEAT_DIM),  dtype=np.float32)
    move_y = np.array(move_y, dtype=np.int64)   if move_y else np.zeros(0, dtype=np.int64)
    atk_X  = np.array(atk_X,  dtype=np.float32) if atk_X  else np.zeros((0, ATTACK_FEAT_DIM), dtype=np.float32)
    atk_y  = np.array(atk_y,  dtype=np.float32) if atk_y  else np.zeros(0, dtype=np.float32)

    return move_X, move_y, atk_X, atk_y, n_files, n_complete


# ─── Networks ─────────────────────────────────────────────────────────────────
class MoveNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(MOVE_FEAT_DIM, 64), nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 64), nn.ReLU(),
            nn.Linear(64, MOVE_CLASSES),
        )

    def forward(self, x):
        return self.net(x)


class MoveNetInference(nn.Module):
    """move_net with softmax for ONNX export (probabilities over 7 directions)."""
    def __init__(self, base: MoveNet):
        super().__init__()
        self.net = base.net

    def forward(self, x):
        return torch.softmax(self.net(x), dim=-1)


class AttackNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(ATTACK_FEAT_DIM, 32), nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 32), nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        return torch.sigmoid(self.net(x))


# ─── Training helpers ──────────────────────────────────────────────────────────
def class_weights_for(y: np.ndarray, n_classes: int) -> torch.Tensor:
    """Inverse-frequency weights to handle class imbalance."""
    counts = np.bincount(y.astype(int), minlength=n_classes).astype(np.float32)
    counts = np.maximum(counts, 1)
    w = counts.sum() / (n_classes * counts)
    return torch.tensor(w, dtype=torch.float32)


def train_epoch(model, loader, criterion, optimizer):
    model.train()
    total_loss = 0.0
    for xb, yb in loader:
        optimizer.zero_grad()
        loss = criterion(model(xb), yb)
        loss.backward()
        optimizer.step()
        total_loss += loss.item()
    return total_loss / len(loader)


def eval_accuracy(model, X: np.ndarray, y: np.ndarray, binary=False):
    model.eval()
    with torch.no_grad():
        out = model(torch.tensor(X))
        if binary:
            preds = (out.squeeze() > 0.5).float()
            return float((preds == torch.tensor(y)).float().mean())
        else:
            preds = out.argmax(dim=1)
            return float((preds == torch.tensor(y, dtype=torch.long)).float().mean())


def export_onnx(model, in_dim, out_path):
    import onnx as _onnx
    out_path = Path(out_path)
    model.eval()
    dummy = torch.zeros(1, in_dim)
    torch.onnx.export(
        model, dummy, str(out_path),
        input_names=['input'], output_names=['output'],
        dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
        opset_version=18,
    )
    # Merge external data into a single self-contained ONNX file
    loaded = _onnx.load(str(out_path))
    _onnx.save_model(loaded, str(out_path), save_as_external_data=False)
    data_file = Path(str(out_path) + '.data')
    if data_file.exists():
        data_file.unlink()
    size_kb = out_path.stat().st_size // 1024
    print(f"  Exported: {out_path}  ({size_kb} KB)")


# ─── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=60,  help='Training epochs (default 60)')
    parser.add_argument('--lr',     type=float, default=1e-3, help='Learning rate (default 1e-3)')
    parser.add_argument('--batch',  type=int, default=64,  help='Batch size (default 64)')
    args = parser.parse_args()

    print("=" * 60)
    print("  Operação Atlântico Sul — Imitation Learning Trainer")
    print("=" * 60)

    if not LOG_DIR.exists() or not any(LOG_DIR.glob("*.jsonl")):
        print(f"\nNo game logs found in: {LOG_DIR}")
        print("\nOptions:")
        print("  1. Play real games — the server now writes logs automatically.")
        print("  2. Generate synthetic data: python ml/simulate_games.py --n 100")
        sys.exit(1)

    print(f"\nLoading game logs from {LOG_DIR} ...")
    move_X, move_y, atk_X, atk_y, n_files, n_complete = load_games(LOG_DIR)

    print(f"\n  Log files:       {n_files}")
    print(f"  Complete games:  {n_complete}")
    print(f"  Move examples:   {len(move_X)}")
    print(f"  Attack examples: {len(atk_X)}  "
          f"({int(atk_y.sum())} positive, {int(len(atk_y)-atk_y.sum())} negative)")

    MIN_COMPLETE = 5
    if n_complete < MIN_COMPLETE:
        print(f"\n⚠  Only {n_complete} complete games "
              f"(recommended ≥ {MIN_COMPLETE} for useful models).")
        print("   Run: python ml/simulate_games.py --n 100   to bootstrap.")
        if len(move_X) == 0 and len(atk_X) == 0:
            print("\nNo examples at all — aborting.")
            sys.exit(1)
        print("   Continuing with available data …\n")

    # ── Train move_net ─────────────────────────────────────────────────────────
    print("\n─── move_net ─────────────────────────────────────────────────")
    if len(move_X) == 0:
        print("  No move examples — skipping.")
        move_net_trained = False
    else:
        cw  = class_weights_for(move_y, MOVE_CLASSES)
        crit = nn.CrossEntropyLoss(weight=cw)
        ds   = TensorDataset(torch.tensor(move_X), torch.tensor(move_y))
        loader = DataLoader(ds, batch_size=args.batch, shuffle=True)
        move_net = MoveNet()
        opt = torch.optim.Adam(move_net.parameters(), lr=args.lr)
        scheduler = torch.optim.lr_scheduler.StepLR(opt, step_size=20, gamma=0.5)

        for epoch in range(args.epochs):
            loss = train_epoch(move_net, loader, crit, opt)
            scheduler.step()
            if (epoch + 1) % 10 == 0:
                acc = eval_accuracy(move_net, move_X, move_y)
                print(f"  Epoch {epoch+1:>3}/{args.epochs}  loss={loss:.4f}  train_acc={acc:.1%}")

        export_onnx(MoveNetInference(move_net), MOVE_FEAT_DIM, MODEL_DIR / "move_net.onnx")
        final_acc = eval_accuracy(move_net, move_X, move_y)
        print(f"  Final train accuracy: {final_acc:.1%}")
        move_net_trained = True

    # ── Train attack_net ───────────────────────────────────────────────────────
    print("\n─── attack_net ───────────────────────────────────────────────")
    if len(atk_X) == 0:
        print("  No attack examples — skipping.")
        atk_net_trained = False
    else:
        pos_w = float((atk_y == 0).sum()) / max(float((atk_y == 1).sum()), 1)
        crit  = nn.BCELoss()
        ds    = TensorDataset(torch.tensor(atk_X),
                              torch.tensor(atk_y[:, None], dtype=torch.float32))
        loader = DataLoader(ds, batch_size=args.batch, shuffle=True)
        atk_net = AttackNet()
        opt = torch.optim.Adam(atk_net.parameters(), lr=args.lr)
        scheduler = torch.optim.lr_scheduler.StepLR(opt, step_size=20, gamma=0.5)

        for epoch in range(args.epochs):
            loss = train_epoch(atk_net, loader, crit, opt)
            scheduler.step()
            if (epoch + 1) % 10 == 0:
                acc = eval_accuracy(atk_net, atk_X, atk_y, binary=True)
                print(f"  Epoch {epoch+1:>3}/{args.epochs}  loss={loss:.4f}  train_acc={acc:.1%}")

        export_onnx(atk_net, ATTACK_FEAT_DIM, MODEL_DIR / "attack_net.onnx")
        final_acc = eval_accuracy(atk_net, atk_X, atk_y, binary=True)
        print(f"  Final train accuracy: {final_acc:.1%}")
        atk_net_trained = True

    # ── Summary ────────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  Models saved in: ml/models/")
    for fname, trained in [("move_net.onnx", move_net_trained), ("attack_net.onnx", atk_net_trained)]:
        status = "✓" if trained else "✗ (skipped)"
        print(f"  {status} {fname}")
    print()
    print("  Feature spec (for server.js integration):")
    print(f"    move_net   input  shape: [batch, {MOVE_FEAT_DIM}]  output: [batch, {MOVE_CLASSES}] probs")
    print(f"    attack_net input  shape: [batch, {ATTACK_FEAT_DIM}]  output: [batch, 1]  prob")
    print()
    print("  Next step: integrate with onnxruntime-node in server.js")
    print("=" * 60)


if __name__ == '__main__':
    main()
