import { Schema } from "effect"

/** A value that can cross a Resonate persistence boundary without coercion. */
export type Type = Schema.Json

/** Runtime validation for values crossing a durable boundary. */
export const schema: Schema.Codec<Type> = Schema.Json
