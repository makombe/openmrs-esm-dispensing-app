import useSWR from 'swr';
import { openmrsFetch, restBaseUrl, useSession } from '@openmrs/esm-framework';
import { type StockDispenseRequest, type InventoryItem, type MedicationDispense } from '../../types';
import { getUuidFromReference } from '../../utils';

//TODO: Add configuration to retrieve the stock dispense endpoint
// For stock dispense to work, stock management module should be installed and configured

/**
 * Fetches the inventory items for a given drug UUID.
 *
 * @param {string} drugUuid - The UUID of the drug.
 * @returns {Array} - The inventory items.
 */
type DispenseStockIdentifier = string | { drugUuid?: string; stockItemUuid?: string };

/**
 * Fetches dispensable inventory (batches) for either a specific stock item
 * (brand) or a drug.
 *
 * Accepts a plain string for backward compatibility with existing callers
 * (treated as drugUuid, unchanged behavior). New callers that need to
 * restrict to one brand — anything downstream of a bill, now that brand
 * StockItems can share a drugUuid — should pass { stockItemUuid } instead:
 * that filters to exactly that brand's batches rather than every brand
 * sharing the drug.
 */
export const useDispenseStock = (identifier: DispenseStockIdentifier) => {
  const session = useSession();
  const { drugUuid, stockItemUuid } =
    typeof identifier === 'string' ? { drugUuid: identifier, stockItemUuid: undefined } : identifier ?? {};

  const itemParam = stockItemUuid ? `stockItemUuid=${stockItemUuid}` : drugUuid ? `drugUuid=${drugUuid}` : null;

  const url = itemParam
    ? `/ws/rest/v1/stockmanagement/stockiteminventory?v=default&totalCount=true&${itemParam}&includeBatchNo=true&groupBy=LocationStockItemBatchNo&dispenseLocationUuid=${session?.sessionLocation?.uuid}&includeStrength=1&includeConceptRefIds=1&emptyBatch=1&emptyBatchLocationUuid=${session?.sessionLocation?.uuid}&dispenseAtLocation=1`
    : null;

  const { data, error, isLoading } = useSWR<{ data: { results: Array<InventoryItem> } }>(url, openmrsFetch);
  return { inventoryItems: data?.data?.results ?? [], error, isLoading };
};

/**
 * Sends a POST request to the inventory dispense endpoint with the provided stock dispense request.
 *
 * @param {AbortController} abortController - The AbortController used to cancel the request.
 * @returns {Promise<Response>} - A Promise that resolves to the response of the POST request.
 */
export async function sendStockDispenseRequest(
  stockDispenseRequest,
  abortController: AbortController,
): Promise<Response> {
  const url = '/ws/rest/v1/stockmanagement/dispenserequest';
  return await openmrsFetch(url, {
    method: 'POST',
    signal: abortController.signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dispenseItems: [stockDispenseRequest] }),
  });
}

/**
 * Creates a stock dispense request payload.
 *
 * @param inventoryItem - The inventory item to dispense.
 * @param patientUuid - The UUID of the patient.
 * @param encounterUuid - The UUID of the encounter.
 * @param medicationDispensePayload - The medication dispense payload.
 * @returns The stock dispense request payload.
 */
export const createStockDispenseRequestPayload = (
  inventoryItem: InventoryItem,
  patientUuid: string,
  encounterUuid: string,
  medicationDispensePayload: MedicationDispense,
): StockDispenseRequest => {
  return {
    dispenseLocation: inventoryItem.locationUuid,
    patient: patientUuid,
    order: getUuidFromReference(medicationDispensePayload.authorizingPrescription[0].reference),
    encounter: encounterUuid,
    stockItem: inventoryItem?.stockItemUuid,
    stockBatch: inventoryItem.stockBatchUuid,
    stockItemPackagingUOM: inventoryItem.quantityUoMUuid,
    quantity: medicationDispensePayload.quantity.value,
  };
};

/**
 * Resolves which stock item (brand) was actually billed for a given
 * order, by reading the cashier bill line item(s) linked to that order.
 *
 * Backed by BillLineItemResource.doSearch's `orderUuid` param, and
 * BillLineItemResource.getItem(), which returns the item property as a
 * string in the form "{stockItemUuid}:{displayName}".
 */
export const useBilledStockItemForOrder = (orderUuid: string) => {
  const url = orderUuid ? `${restBaseUrl}/cashier/billLineItem?orderUuid=${orderUuid}&v=default` : null;
  const { data, error, isLoading } = useSWR<{
    data: { results: Array<{ item: string; uuid: string; voided?: boolean }> };
  }>(url, openmrsFetch);

  const results = (data?.data?.results ?? []).filter((li) => !li.voided);
  const lineItem = results[results.length - 1];

  let billedStockItemUuid: string | null = null;
  let billedStockItemName: string | null = null;
  if (lineItem?.item) {
    const [stockItemUuid, ...rest] = lineItem.item.split(':');
    billedStockItemUuid = stockItemUuid || null;
    billedStockItemName = rest.join(':') || null;
  }

  return {
    billedStockItemUuid,
    billedStockItemName,
    hasBill: results.length > 0,
    isLoading,
    error,
  };
};
