// A habit's glyph, by key.
//
// The one place in the feature that knows which icon package is underneath.
// Habit rows store this app's own key — "mosque", not "IconBuildingMosque" —
// so the set can be swapped without rewriting a year of rows, and the keys
// themselves live in MONK_ICONS (src/lib/monkMode.ts) where the settings
// picker reads their labels.
//
// Tabler, at stroke 1.75, which is the weight the sidebar dialled the set to
// so it sits with the app's in-house glyphs.

import {
  IconBan,
  IconBarbell,
  IconBed,
  IconBook,
  IconBrain,
  IconBuildingMosque,
  IconClock,
  IconCoffeeOff,
  IconDeviceLaptop,
  IconDeviceMobileOff,
  IconDroplet,
  IconFlame,
  IconGlassFull,
  IconHeart,
  IconMoon,
  IconMountain,
  IconNotebook,
  IconPencil,
  IconRun,
  IconSalad,
  IconSun,
  IconSwimming,
  IconTargetArrow,
  IconWalk,
  IconYoga,
} from "@tabler/icons-react";
import { monkIconKey } from "@/lib/monkMode";

const GLYPHS: Record<string, typeof IconBan> = {
  ban: IconBan,
  mosque: IconBuildingMosque,
  book: IconBook,
  droplet: IconDroplet,
  meditation: IconYoga,
  laptop: IconDeviceLaptop,
  dumbbell: IconBarbell,
  run: IconRun,
  walk: IconWalk,
  swim: IconSwimming,
  bed: IconBed,
  water: IconGlassFull,
  salad: IconSalad,
  brain: IconBrain,
  pencil: IconPencil,
  notebook: IconNotebook,
  "phone-off": IconDeviceMobileOff,
  "no-coffee": IconCoffeeOff,
  sun: IconSun,
  moon: IconMoon,
  flame: IconFlame,
  heart: IconHeart,
  mountain: IconMountain,
  clock: IconClock,
  target: IconTargetArrow,
};

export default function MonkIcon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  // monkIconKey falls an unknown key back to the target rather than rendering
  // nothing: a card with a hole in it reads as a broken app, and a card with
  // the wrong glyph reads as a habit.
  const Glyph = GLYPHS[monkIconKey(name)] ?? IconTargetArrow;
  return <Glyph size={size} stroke={1.75} className={className} aria-hidden />;
}
