const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
};

export const featureFlags = {
  boultOperatorRuntimeV2: parseBoolean(process.env.BOULT_OPERATOR_RUNTIME_V2, true),
  boultCanvasActionsV2: parseBoolean(process.env.BOULT_CANVAS_ACTIONS_V2, true),
  boultExecutionGatewayV1: parseBoolean(process.env.BOULT_EXECUTION_GATEWAY_V1, true),
  boultPlanModeV2: parseBoolean(process.env.BOULT_PLAN_MODE_V2, true),
  boultFreeRouterV2: parseBoolean(process.env.BOULT_FREE_ROUTER_V2, true),
  boultPlanEngine: parseBoolean(process.env.BOULT_PLAN_ENGINE, true),
  boultNotionAdapter: parseBoolean(process.env.BOULT_NOTION_ADAPTER, true),
  boultGoogleTasks: parseBoolean(process.env.BOULT_GOOGLE_TASKS, true),
  boultSearchTransparency: parseBoolean(process.env.BOULT_SEARCH_TRANSPARENCY, true),
  boultAgentLoopV1: parseBoolean(process.env.BOULT_AGENT_LOOP_V1, true),
};

export function isFeatureEnabled(flagName) {
  return Boolean(featureFlags[flagName]);
}
