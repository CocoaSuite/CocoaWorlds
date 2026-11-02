# Paths and trains

A **path** is a chain of **Path point** objects. Add an empty object (Add › Empty object), give it a Path
point component, and pick its **Next point**. Point the last one back at the first to make a loop. While
editing, routes show as cyan lines with an arrow halfway along each one.

Each point can also set:

- **New speed**: the speed from that point on (0 keeps the current speed).
- **Wait here**: seconds the train stops at that point.
- **Message when reached**: a message sent to every script when a train arrives (“When this gets a message”).
  Use it to open a door ahead, or to stop at a station.

A **Train** component moves an object (a brush, a group, a model) along a path. In Play, it starts at its
**First point** and goes from point to point at **Speed**, carrying the player standing on it. Its pivot
follows the path, so set the pivot (Bottom, or by hand) where the object should touch the route. With
**Turns to face its way** on, it turns to face along the path; build it facing −Z. At a point with no next
point, it stops.

**Moves at the start** off makes it wait until a **Start the train** block. **Stop the train** stops it
where it is. Both blocks are in the Do group.
