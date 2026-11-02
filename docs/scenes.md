# Scenes and level changes

A project can hold several scenes: levels, a title screen, a hub. The scene's name in the top bar (beside the
project's name) opens the **scene picker**:

- Pick a scene to open it. The scene you're leaving is saved first.
- **New scene…** adds one, with a Player start and a sun like a new project's first scene.
- **Start the game in this scene** decides where Play from an exported game begins (marked “the game starts
  here”). Play in the editor always starts in the scene that is open.

## Level changes (Half-Life style)

A **Level change** component on a brush turns it into a zone (amber, like a trigger) that takes the player to
another scene (**Goes to**) when they walk in. The player keeps their health, armour, items, the weapon in
hand, the score and game values. The other scene's **When the game starts** stacks run as it begins.

To make the change seamless, build the same stretch of corridor at the end of one scene and the start of the
next. Put an empty object with the **Landmark** component at the same spot of that corridor in both scenes,
with the same name, and give that name as the zone's **Landmark**. The player then arrives exactly where they
were relative to the landmark, facing and moving the same way. Without a landmark, they arrive at the next
scene's Player start.

A level-change zone the player arrives inside doesn't send them straight back: it works only once they have
been outside it.

The **Go to the scene** block (Player and score) does the same from a script, for example from a menu button,
or after an ending. Its landmark is optional.

Exported games include every scene of the project.
