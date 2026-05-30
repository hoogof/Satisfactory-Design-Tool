export interface ItemRate {
  item: string;
  ratePerMin: number;
}

export interface Recipe {
  id: string;
  name: string;
  isAlternate: boolean;
  machines: string[];
  inputs: ItemRate[];
  outputs: ItemRate[];
  unlockMethod: string;
}

export interface Machine {
  id: string;
  name: string;
  category: string;
  powerConsumptionMW: number;
  tier: number;
  description: string;
}

export interface RecipeNodeData extends Record<string, unknown> {
  recipeId: string;
  machineCount: number;
  selectedMachine: string;
  recipe?: Recipe;
  inputSupply?: Record<string, number>;
}

export interface SourceNodeData extends Record<string, unknown> {
  item: string;
  ratePerMin: number;
}

export interface SinkNodeData extends Record<string, unknown> {
  item: string;
}

// memberIds removed — membership is derived from node.parentId === factoryId
export interface FactoryNodeData extends Record<string, unknown> {
  label: string;
  color: string;
}
