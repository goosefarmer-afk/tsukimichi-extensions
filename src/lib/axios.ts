import { AxiosHeaders, type AxiosHeaderValue } from "axios";

class HeadersBuilder extends AxiosHeaders {
  add(key: string, value: AxiosHeaderValue): this {
    super.set(key, value);
    return this;
  }

  build(): AxiosHeaders {
    return new AxiosHeaders(this.toJSON());
  }
}

export const headersBuilders = new HeadersBuilder();
