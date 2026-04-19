declare module "dxf-writer" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Drawing = any;
  const Drawing: {
    new (): Drawing;
    ACI: {
      WHITE: number; BLACK: number; RED: number; GREEN: number; BLUE: number;
      YELLOW: number; CYAN: number; MAGENTA: number;
      [k: string]: number;
    };
  };
  export default Drawing;
}

declare module "dxf" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class Helper {
    constructor(text: string);
    parsed: any;
    denormalised: any[];
    toSVG(): string;
  }
}
