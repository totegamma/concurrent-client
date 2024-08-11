import {CCID, ProfileOverride} from "./core";

export interface CreateCurrentOptions {
    emojis?: Record<string, {imageURL?: string, animURL?: string}>
    profileOverride?: ProfileOverride
    mentions?: CCID[]
}

export interface SubProfile {
    profileID?: string;
}

export interface CreatePlaintextCrntOptions {
    profileOverride?: SubProfile
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
}
