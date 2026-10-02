import { defineEventHandler } from 'h3'
import { buildServerMetadata } from '../../utils/discovery'

export default defineEventHandler((event) => buildServerMetadata(event))
