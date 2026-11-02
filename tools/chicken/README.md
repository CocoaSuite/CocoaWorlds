# The chicken

`chicken_source.glb` is the chicken as modelled: one mesh, three materials, facing +X, no skeleton. `rig.py`
turns it into `apps/editor/samples/chicken.glb`, the ready-made creature in the editor (Add › Chicken):

- faces −Z (the engine's forward) with its feet on the origin;
- an 11-bone skeleton (root, body, neck, head, tail, both wings, both legs and feet) with smooth weights worked
  out from the shape (the legs and beak are found by the orange mask painted in its second vertex colour);
- clumsy animations: `idle` (breathing, jerky looks about, a tail shake), `walk` (a gentle waddle with the head
  bobbing), `run` (leaning forward, wings flailing), `peck` (two jabs at the ground), `flap` (a startled hop)
  and `die` (a last flap, then over onto its side);
- wings that rest pressed flat against the body (scaled thin along their outward axis, also in the rest pose);
  raising a wing unfolds it to full size.

Run it again after changing it (Python 3 with NumPy):

```
python3 rig.py chicken_source.glb ../../apps/editor/samples/chicken.glb
```

The result passes the Khronos glTF validator with no errors.
