import { useEffect, useRef, useState } from "react";
import type { AssetDescriptor, AssetReadInput, ChatTransport, Message } from "../lib/types";

export type ChatAssetReader = Pick<ChatTransport, "readAsset">["readAsset"];

/** Builds the complete authorization tuple required by chat_asset_read. */
export function chatAssetReadInput(
  message: Pick<Message, "conversationId" | "id">,
  asset: AssetDescriptor,
): AssetReadInput {
  return {
    conversationId: message.conversationId,
    messageId: message.id,
    ordinal: asset.ordinal,
    assetId: asset.assetId,
  };
}

export interface ChatAssetBlobUrlState {
  url: string | null;
  loading: boolean;
  error: unknown;
}

/**
 * Reads one committed asset on demand and owns exactly one object URL.
 * The URL is revoked whenever the exact read tuple changes, the read is disabled,
 * or the consumer unmounts. Use separate hook instances for thumbnail and large
 * preview lifetimes.
 */
export function useChatAssetBlobUrl(
  readAsset: ChatAssetReader,
  input: AssetReadInput,
  mediaType: string,
  enabled = true,
): ChatAssetBlobUrlState {
  const [state, setState] = useState<ChatAssetBlobUrlState>({
    url: null,
    loading: enabled,
    error: null,
  });
  const reader = useRef(readAsset);
  reader.current = readAsset;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!enabled) {
      setState({ url: null, loading: false, error: null });
      return () => { active = false; };
    }

    setState({ url: null, loading: true, error: null });
    void reader.current(input).then((bytes) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
      setState({ url: objectUrl, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setState({ url: null, loading: false, error });
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, input.assetId, input.conversationId, input.messageId, input.ordinal, mediaType]);

  return state;
}
