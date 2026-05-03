export interface BridgeMessage {
  type: string;
  correlationId: string;
  payload: unknown;
}
