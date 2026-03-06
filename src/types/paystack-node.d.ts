declare module 'paystack-node' {
  export default class Paystack {
    constructor(secretKey: string);
    transaction: {
      initialize(params: any): Promise<any>;
      verify(reference: string): Promise<any>;
    };
  }
}
