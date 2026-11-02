# Weapons

Any item can be a weapon. In the **Screens** workspace, under **Items**, press **+⌖** beside an item and pick
a ready-made weapon. Every setting can be changed afterwards.

| Ready-made | Fires | Damage | Shots a second | Uses up |
|---|---|---|---|---|
| Crowbar | swings, 64 u reach | 10 | 2.5, held | nothing |
| Pistol | bullets, 1° spread | 8 | 4, a click each | 9mm |
| Machine gun | bullets, 3° spread | 5 | 10, held | 9mm |
| Shotgun | 6 pellets, 5° spread | 5 each | 1.3 | Shells |
| Rocket launcher | rockets, 1000 u/s | 100 blast, 160 radius | 0.6 | Rockets |
| Grenades | thrown in an arc, go off after 2.5 s | 100 blast, 160 radius | 1 | Grenades |

## Playing

- The weapon in the picked hotbar slot (keys 1–9 or the mouse wheel) fires with a click, or while the button
  is held if **Keeps firing while held** is on. Without a hotbar on screen, the slots are the items carried,
  in order.
- Each shot uses one of the **Uses up** item. Give the player ammo like any other item: the **Give an item**
  block, from a pickup, a shop or the start of the game. With none left, the weapon doesn't fire.
- The weapon in hand and its ammo show in the bottom-right corner.

## What shots do

- **Bullets** hit at once along the view, up to **Reach**, straying up to **Spread** degrees. A shotgun fires
  several **Pellets** at a time.
- **Swings** (melee) hit what is within **Reach**.
- **Projectiles** fly at **Speed**. Rockets go straight and blow up on what they hit. Grenades (**Falls**) arc,
  bounce, and go off when their fuse ends.
- A hit takes **Damage** from a breakable object (or the breakable object it is inside) and pushes physics
  objects (**Push**). A **Blast radius** above 0 makes a blast where it lands: damage and push fall off to
  nothing at its edge and don't pass through walls. Blasts hurt the player too, armour first, and throw them
  (rocket jumps work).
- Anything hit runs its **When this is hit (shot, struck or blasted)** stacks, and so does what it is inside:
  shootable buttons, targets, alarms.

A **Sound** from the project plays on each shot.

## Marks and particles

Bullets and swings leave a mark where they hit, with a few sparks and a puff of dust. Blasts leave a scorch on
the surface they hit, with fire, sparks and smoke. A mark on something that moves goes with it. The newest
160 marks are kept.

A **Particles** component on a point object (Add › Empty object) gives off **Smoke**, **Fire**, **Sparks**,
**Steam** or **Dust**, upwards along the object's +Y; turn the object to aim it. **Per second**, **Size** and
**Speed** set how much and how big. **On at the start** decides whether it runs from the beginning, and the
**Turn on** and **Turn off** blocks start and stop it (as does hiding the object). Emitters inside an object
that moves go with it. Particles show while playing, not while editing.
