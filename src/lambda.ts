/**
 * AWS Lambda adapter — do NOT edit. `npm run build:lambda` bundles this into
 * dist/lambda.mjs; point the function handler at `lambda.handler`.
 * Works behind API Gateway (v1/v2), an ALB, or a Lambda function URL.
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp();

export const handler = handle(app);
