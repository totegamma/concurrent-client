/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

export interface EmojiAssociation {
  imageUrl: string;
  shortcode: string;
  profileOverride?: {
    username?: string;
    avatar?: string;
    description?: string;
    link?: string;
    characterID?: string;
  };
}