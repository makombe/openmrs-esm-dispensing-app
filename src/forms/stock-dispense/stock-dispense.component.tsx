import React from 'react';
import { useTranslation } from 'react-i18next';
import { ComboBox, InlineLoading, InlineNotification, Layer } from '@carbon/react';
import { formatDate, useConfig } from '@openmrs/esm-framework';
import { type MedicationDispense, type InventoryItem } from '../../types';
import { type PharmacyConfig } from '../../config-schema';
import { useDispenseStock, useBilledStockItemForOrder } from './stock.resource';
import { getUuidFromReference } from '../../utils';

type StockDispenseProps = {
  medicationDispense: MedicationDispense;
  updateInventoryItem: (inventoryItem: InventoryItem) => void;
  inventoryItem: InventoryItem;
};

const StockDispense: React.FC<StockDispenseProps> = ({ medicationDispense, updateInventoryItem }) => {
  const { t } = useTranslation();
  const config = useConfig<PharmacyConfig>();

  const orderDrugUuid = medicationDispense?.medicationReference?.reference?.split('/')[1];
  const orderUuid = getUuidFromReference(medicationDispense?.authorizingPrescription?.[0]?.reference);
  const { billedStockItemUuid, isLoading: isLoadingBill } = useBilledStockItemForOrder(orderUuid ?? '');

  /**
   * Business rule: which batches are eligible for dispensing.
   *
   * - billedStockItemUuid resolved: this order was billed against a
   *   specific brand — scope batches strictly to that stock item, never to
   *   the shared drugUuid (which would surface sibling brands' batches).
   * - billedStockItemUuid not resolved: no bill line item for this order,
   *   so the drug is treated as non-billable — fall back to drugUuid,
   *   unrestricted across brands (legacy behavior).
   */
  const dispenseIdentifier = billedStockItemUuid ? { stockItemUuid: billedStockItemUuid } : { drugUuid: orderDrugUuid };

  const { inventoryItems, error, isLoading } = useDispenseStock(dispenseIdentifier);

  const validInventoryItems = inventoryItems
    .filter((item) => isValidBatch(medicationDispense, item))
    .sort((a, b) => new Date(a.expiration).getTime() - new Date(b.expiration).getTime());

  function parseDate(dateString) {
    return new Date(dateString);
  }

  //check whether the drug will expire before the medication period ends
  function isValidBatch(medicationToDispense, inventoryItem) {
    if (typeof config !== 'undefined' && !config.validateBatch) {
      return true;
    }
    if (medicationToDispense?.dosageInstruction && medicationToDispense?.dosageInstruction.length > 0) {
      return medicationToDispense.dosageInstruction.some((instruction) => {
        if (
          instruction.timing?.repeat?.duration &&
          instruction.timing?.repeat?.durationUnit &&
          inventoryItem.quantity > 0
        ) {
          const durationUnit = instruction.timing.repeat.durationUnit;
          const durationValue = instruction.timing.repeat.duration;
          const lastMedicationDate = new Date();

          switch (durationUnit) {
            case 's':
              lastMedicationDate.setSeconds(lastMedicationDate.getSeconds() + durationValue);
              break;
            case 'min':
              lastMedicationDate.setMinutes(lastMedicationDate.getMinutes() + durationValue);
              break;
            case 'h':
              lastMedicationDate.setHours(lastMedicationDate.getHours() + durationValue);
              break;
            case 'd':
              lastMedicationDate.setDate(lastMedicationDate.getDate() + durationValue);
              break;
            case 'wk':
              lastMedicationDate.setDate(lastMedicationDate.getDate() + durationValue * 7);
              break;
            case 'mo':
              lastMedicationDate.setMonth(lastMedicationDate.getMonth() + durationValue);
              break;
            case 'y':
              lastMedicationDate.setFullYear(lastMedicationDate.getFullYear() + durationValue);
              break;
            default:
              return false;
          }

          const expiryDate = parseDate(inventoryItem.expiration);
          return expiryDate > lastMedicationDate;
        }
        return false;
      });
    }
    return false;
  }

  const toStockDispense = (inventoryItems) => {
    return t(
      'stockDispenseDetails',
      'Batch: {{batchNumber}} - Quantity: {{quantity}} ({{quantityUoM}}) - Expiry: {{expiration}}',
      {
        batchNumber: inventoryItems.batchNumber,
        quantity: Math.floor(inventoryItems.quantity),
        quantityUoM: inventoryItems.quantityUoM,
        expiration: formatDate(new Date(inventoryItems.expiration)),
      },
    );
  };

  if (isLoadingBill) {
    return <InlineLoading description={t('resolvingBilledBrand', 'Resolving billed brand...')} />;
  }

  if (error) {
    return (
      <InlineNotification
        aria-label="closes notification"
        kind="error"
        lowContrast={true}
        statusIconDescription="notification"
        subtitle={t('errorLoadingInventoryItems', 'Error fetching inventory items')}
        title={t('error', 'Error')}
      />
    );
  }

  if (isLoading) {
    return <InlineLoading description={t('loadingInventoryItems', 'Loading inventory items...')} />;
  }

  return (
    <Layer>
      <ComboBox
        id="stockDispense"
        items={validInventoryItems}
        onChange={({ selectedItem }) => {
          updateInventoryItem(selectedItem);
        }}
        itemToString={(item) => (item ? toStockDispense(item) : '')}
        titleText={t('stockDispense', 'Stock Dispense')}
        placeholder={t('selectStockDispense', 'Select stock to dispense from')}
      />
    </Layer>
  );
};

export default StockDispense;
