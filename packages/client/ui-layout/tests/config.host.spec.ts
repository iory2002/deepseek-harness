import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_LAYOUT_ARRANGEMENT, Config, apply,
} from '@deepseek-ai/dsh-client-ui-layout'

describe('ui-layout host', () => {
  it('registers, validates, and disposes the durable arrangement preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.config)).toEqual({ arrangement: DEFAULT_LAYOUT_ARRANGEMENT })
    await configuration.update({ arrangement: 'workspace-center' })
    expect(plainConfig(configuration.fiber.config)).toEqual({ arrangement: 'workspace-center' })
    await expect(configuration.update({ arrangement: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
