declare module "powerbi-client-react" {
  import type { Embed, IEmbedConfiguration, service } from "powerbi-client";
  import type { ComponentType } from "react";

  interface PowerBIEmbedProps {
    embedConfig: IEmbedConfiguration;
    eventHandlers?: Map<string, (event?: CustomEvent, embeddedEntity?: Embed) => void | Promise<void>>;
    cssClassName?: string;
    getEmbeddedComponent?: (embedObject: Embed) => void;
  }

  export const PowerBIEmbed: ComponentType<PowerBIEmbedProps>;
  export { models } from "powerbi-client";
}
