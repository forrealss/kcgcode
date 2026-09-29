/**
 * Pemetaan avatar bawaan (id preset) -> ikon lucide + warna latar.
 * Id-nya didefinisikan di `lib/avatar-presets.ts` (dipakai server juga).
 */
import {
  BirdIcon,
  BotIcon,
  CatIcon,
  CoffeeIcon,
  DogIcon,
  FishIcon,
  Flower2Icon,
  Gamepad2Icon,
  GhostIcon,
  LeafIcon,
  type LucideIcon,
  MountainIcon,
  PandaIcon,
  RabbitIcon,
  RocketIcon,
  SquirrelIcon,
  TurtleIcon,
} from "lucide-react";
import type { AvatarPresetId } from "@/lib/avatar-presets";

export interface AvatarPreset {
  label: string;
  Icon: LucideIcon;
  /** Kelas latar + warna ikon (terang & gelap). */
  className: string;
}

export const AVATAR_PRESETS: Record<AvatarPresetId, AvatarPreset> = {
  cat: {
    label: "Cat",
    Icon: CatIcon,
    className: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  dog: {
    label: "Dog",
    Icon: DogIcon,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  rabbit: {
    label: "Rabbit",
    Icon: RabbitIcon,
    className: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  },
  panda: {
    label: "Panda",
    Icon: PandaIcon,
    className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  },
  bird: {
    label: "Bird",
    Icon: BirdIcon,
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  fish: {
    label: "Fish",
    Icon: FishIcon,
    className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  },
  turtle: {
    label: "Turtle",
    Icon: TurtleIcon,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  squirrel: {
    label: "Squirrel",
    Icon: SquirrelIcon,
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  },
  rocket: {
    label: "Rocket",
    Icon: RocketIcon,
    className: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  bot: {
    label: "Robot",
    Icon: BotIcon,
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  ghost: {
    label: "Ghost",
    Icon: GhostIcon,
    className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  },
  gamepad: {
    label: "Gamepad",
    Icon: Gamepad2Icon,
    className: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  },
  flower: {
    label: "Flower",
    Icon: Flower2Icon,
    className: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
  leaf: {
    label: "Leaf",
    Icon: LeafIcon,
    className: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  },
  mountain: {
    label: "Mountain",
    Icon: MountainIcon,
    className: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  },
  coffee: {
    label: "Coffee",
    Icon: CoffeeIcon,
    className: "bg-stone-500/15 text-stone-700 dark:text-stone-300",
  },
};
