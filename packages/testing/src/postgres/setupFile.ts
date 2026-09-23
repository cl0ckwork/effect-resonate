import { inject } from "vitest"

const { postgresPort, integresqlPort, templateHash } = inject("postgres")

process.env.ITEST_POSTGRES_PORT = String(postgresPort)
process.env.ITEST_INTEGRESQL_URL = `http://127.0.0.1:${integresqlPort}/`
process.env.ITEST_TEMPLATE_HASH = templateHash
