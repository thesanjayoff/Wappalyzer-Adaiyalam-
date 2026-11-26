export interface GroundTruthSite {
  url: string;
  expectedTechIds: string[];
  evidence: string;
}

export interface NegativeControlSite {
  url: string;
  mustNotDetect: string[];
  evidence: string;
}

export interface GroundTruthFile {
  verifiedAsOf: string;
  method: string;
  sites: GroundTruthSite[];
  negativeControls: NegativeControlSite[];
}
