import {
  RDTableHeader,
  RDTableHeaderDate,
  RDTableHeaderIndicator,
  RDTableHeaderMultiSelect,
  RDTableHeaderSearch,
  RDTableHeaderSingleSelect,
  RDTableInputDropdownMultiSelectChip,
  RDTableInputDropdownSelectItem,
} from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import {
  PAYMENT_ENTRY_STATUS,
  PAYMENT_METHOD_DROPDOWN_VALUES,
  PAYMENT_REQUEST_MODULE,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import useAppParams from "../../../../hooks/useAppParams";
import {
  useLazyGetPaymentEntryProjectListFilterDataQuery,
  useLazyGetPaymentEntryRequestedByListFilterDataQuery,
  useLazyGetPaymentEntryVendorListFilterDataQuery,
} from "../../../../services/payment-request.service";
import { toTitleCase } from "../../../../utils/case-conversion";
import { isSearchValueExist } from "../../../../utils/common-methods";
import {
  getPaymentEntryProjectFilterDropdownApiEndpoint,
  getPaymentEntryRequestedByFilterApiEndpoint,
  getPaymentEntryTableGridColumnsClass,
  getPaymentRequestModule,
  initialPaymentEntryFilterData,
} from "../../../../utils/payment-request";
import type { IPaymentEntryTableHeaderProps } from "./interface";

const PaymentEntryTableHeader = (props: IPaymentEntryTableHeaderProps) => {
  const module = getPaymentRequestModule();
  const { projectId = "", vendorId = "", orgId: clientId = "" } = useAppParams();
  const [fetchVendorList, vendorListState] = useLazyGetPaymentEntryVendorListFilterDataQuery();
  const [fetchRequestedByList, requestedByListState] = useLazyGetPaymentEntryRequestedByListFilterDataQuery();
  const [fetchProjectList, projectListState] = useLazyGetPaymentEntryProjectListFilterDataQuery();
  const clearFilter = () => {
    props.setFilterData(initialPaymentEntryFilterData);
  };

  const handleChange = (name: string, value: string) => {
    props.setFilterData((prev) => ({ ...prev, [name]: value }));
  };

  const getIsFilterActive = () => {
    return !!(
      props.filterData.requestId ||
      props.filterData.paymentDate ||
      props.filterData.paymentDone ||
      props.filterData.paymentMethod.id ||
      props.filterData.requestType.id ||
      props.filterData.vendors.length ||
      props.filterData.uploadedBy.length ||
      props.filterData.status ||
      props.filterData.project.length
    );
  };

  return (
    <RDTableHeader className={clsx("display-grid payment-entry-table-columns bg-white border-b", getPaymentEntryTableGridColumnsClass())}>
      <RDTableHeaderIndicator
        colId="sno"
        colTitle="S.No"
        isApplied={getIsFilterActive()}
        clearFilter={clearFilter}
        alignment="center"
      />
      <RDTableHeaderDate
        colId="paymentDate"
        colTitle="Payment Date"
        value={props.filterData.paymentDate}
        setValue={handleChange}
      />
      <RDTableHeaderSearch
        colId="requestId"
        colTitle="Request ID"
        value={props.filterData.requestId}
        handleSearch={handleChange}
      />
      <RDTableHeaderSearch
        colId="transactionId"
        colTitle="Transaction ID"
        value={props.filterData.transactionId}
        handleSearch={handleChange}
      />

      <RDTableHeaderSingleSelect
        colId="paymentMethod"
        colTitle="Payment Method"
        placeholder="Select"
        value={props.filterData.paymentMethod.id ? props.filterData.paymentMethod : null}
        setValue={(value) => props.setFilterData((prev) => ({ ...prev, paymentMethod: { id: value?.id ?? "", name: value?.name ?? "" } }))}
        dropDownValue={PAYMENT_METHOD_DROPDOWN_VALUES}
        dropdownItem={(element, index) => ({
          key: index,
          element: <RDTableInputDropdownSelectItem>{element.name}</RDTableInputDropdownSelectItem>,
        })}
        dropdownLabel={(item) => item.name}
      />

      {[PAYMENT_REQUEST_MODULE.manageClientPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module) && (
        <RDTableHeaderMultiSelect
          colId="projectName"
          colTitle="Project Name"
          value={props.filterData.project}
          dropDownValue={projectListState.data || []}
          dropdownClip={(item, index, remove) => ({
            key: item.id,
            element: (
              <RDTableInputDropdownMultiSelectChip
                remove={remove}
                value={item.name}
              />
            ),
          })}
          dropdownItem={(element) => ({
            key: element.id,
            element: <RDTableInputDropdownSelectItem>{element.name}</RDTableInputDropdownSelectItem>,
          })}
          setValue={(value) => props.setFilterData((prev) => ({ ...prev, project: value }))}
          search={true}
          searchFilter={(item, searchtext) => isSearchValueExist(searchtext, item.name)}
          isLoading={projectListState.isLoading}
          onDropdownClick={() =>
            fetchProjectList({
              apiEndpoint: getPaymentEntryProjectFilterDropdownApiEndpoint(),
              params: { vendor_id: vendorId || undefined, client_id: clientId || undefined },
            })
          }
          width={250}
        />
      )}
      {module === PAYMENT_REQUEST_MODULE.orderPaymentRequest && (
        <RDTableHeaderMultiSelect
          colId="vendorName"
          colTitle="Vendor Name"
          value={props.filterData.vendors}
          dropDownValue={vendorListState.data || []}
          dropdownClip={(item, index, remove) => ({
            key: item.id,
            element: (
              <RDTableInputDropdownMultiSelectChip
                remove={remove}
                value={item.name}
              />
            ),
          })}
          dropdownItem={(element) => ({
            key: element.id,
            element: <RDTableInputDropdownSelectItem>{element.name}</RDTableInputDropdownSelectItem>,
          })}
          setValue={(value) => props.setFilterData((prev) => ({ ...prev, vendors: value }))}
          search={true}
          searchFilter={(item, searchtext) => isSearchValueExist(searchtext, item.name)}
          isLoading={vendorListState.isLoading}
          onDropdownClick={() =>
            fetchVendorList({ project_id: projectId || undefined, vendor_id: vendorId || undefined, client_id: clientId || undefined })
          }
          width={250}
        />
      )}

      <RDTableHeaderSingleSelect
        colId="requestType"
        colTitle="Request Type"
        placeholder="Select"
        value={props.filterData.requestType.id ? props.filterData.requestType : null}
        setValue={(value) => props.setFilterData((prev) => ({ ...prev, requestType: { id: value?.id ?? "", name: value?.name ?? "" } }))}
        dropDownValue={REQUEST_TYPE_DROPDOWN_VALUES}
        dropdownItem={(element, index) => ({
          key: index,
          element: <RDTableInputDropdownSelectItem>{element.name}</RDTableInputDropdownSelectItem>,
        })}
        dropdownLabel={(item) => item.name}
      />

      <RDTableHeaderMultiSelect
        colId="uploadedBy"
        colTitle="Uploaded by"
        value={props.filterData.uploadedBy}
        dropDownValue={requestedByListState.data || []}
        dropdownClip={(item, index, remove) => ({
          key: item.id,
          element: (
            <RDTableInputDropdownMultiSelectChip
              remove={remove}
              value={item.name}
            />
          ),
        })}
        dropdownItem={(element) => ({
          key: element.id,
          element: <RDTableInputDropdownSelectItem>{element.name}</RDTableInputDropdownSelectItem>,
        })}
        setValue={(value) => props.setFilterData((prev) => ({ ...prev, uploadedBy: value }))}
        search={true}
        searchFilter={(item, searchText) => isSearchValueExist(searchText, item.name)}
        isLoading={requestedByListState.isLoading}
        onDropdownClick={() =>
          fetchRequestedByList({
            apiEndpoint: getPaymentEntryRequestedByFilterApiEndpoint(),
            params: { project_id: projectId || undefined, vendor_id: vendorId || undefined, client_id: clientId || undefined },
          })
        }
        width={250}
      />

      <RDTableHeaderSingleSelect
        colId="status"
        colTitle="Status"
        placeholder="Select"
        value={props.filterData.status}
        setValue={(value) => props.setFilterData((prev) => ({ ...prev, status: value || "" }))}
        dropDownValue={Object.values(PAYMENT_ENTRY_STATUS)}
        dropdownItem={(element, index) => ({
          key: index,
          element: <RDTableInputDropdownSelectItem>{toTitleCase(element)}</RDTableInputDropdownSelectItem>,
        })}
        dropdownLabel={(item) => item}
      />

      <RDTableHeaderSearch
        colId="paymentDone"
        colTitle={`Payment Done (${props.i18n.currencySymbol})`}
        value={props.filterData.paymentDone}
        handleSearch={handleChange}
        alignment="right"
      />

      <div />
    </RDTableHeader>
  );
};

export default PaymentEntryTableHeader;
