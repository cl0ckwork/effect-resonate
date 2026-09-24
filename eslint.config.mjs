import eslint from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

const effectPatternMatching = [
  "error",
  {
    selector: "SwitchStatement",
    message: "Use Effect Match instead of switch statements."
  },
  {
    selector: "BinaryExpression[operator='==='] > MemberExpression[property.name='_tag']",
    message: "Use Match.valueTags, Match.tagsExhaustive, or a native Effect matcher instead of comparing _tag."
  },
  {
    selector: "BinaryExpression[operator='!=='] > MemberExpression[property.name='_tag']",
    message: "Use Match.valueTags, Match.tagsExhaustive, or a native Effect matcher instead of comparing _tag."
  }
]

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**"
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: "module"
    },
    rules: {
      "no-restricted-syntax": effectPatternMatching
    }
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended
    ],
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      sourceType: "module"
    },
    rules: {
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "no-restricted-syntax": effectPatternMatching
    }
  },
  {
    files: ["**/*.types.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off"
    }
  }
])
