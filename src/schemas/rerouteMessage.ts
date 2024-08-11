/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

export interface RerouteMessageSchema {
  rerouteMessageId: string;
  rerouteMessageAuthor: string;
  body?: string;
  emojis?: {
    [k: string]: {
      imageURL?: string;
      animURL?: string;
    };
  };
  profileOverride?: {
    username?: string;
    avatar?: string;
    description?: string;
    link?: string;
    profileID?: string;
  };
}
