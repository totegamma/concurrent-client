import {CCID, ProfileOverride} from "./core";

export interface CreateCurrentOptions {
    emojis: Record<string, {imageURL?: string, animURL?: string}>
    profileOverride: ProfileOverride
    mentions: CCID[]
}