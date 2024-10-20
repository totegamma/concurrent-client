import {CCID, ProfileOverride} from "./core";

export interface CreateCurrentOptions {
    emojis?: Record<string, {imageURL?: string, animURL?: string}>
    profileOverride?: ProfileOverride
    mentions?: CCID[]
    whisper?: CCID[]
    isPrivate?: boolean
}

export interface SubProfile {
    profileID?: string;
}

export interface CreatePlaintextCrntOptions {
    profileOverride?: SubProfile
    whisper?: CCID[]
    isPrivate?: boolean
}

export interface CreateMediaCrntOptions {
    emojis?: Record<string, {imageURL?: string, animURL?: string}>
    profileOverride?: SubProfile
    medias?: {
        mediaURL: string;
        mediaType: string;
        thumbnailURL?: string;
        blurhash?: string;
    }[]
    whisper?: CCID[],
    isPrivate?: boolean
}
