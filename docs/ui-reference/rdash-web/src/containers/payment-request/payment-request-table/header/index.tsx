import {
  RDTableHeader,
  RDTableHeaderDate,
  RDTableHeaderDateV2,
  RDTableHeaderIndicator,
  RDTableHeaderMultiSelect,
  RDTableHeaderSearch,
  RDTableHeaderSingleSelect,
  RDTableInputDropdownMultiSelectChip,
  RDTableInputDropdownSelectItem,
} from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import {
  PAYMENT_REQUEST_MODULE,
  PAYMENT_REQUEST_STATUS,
  PAYMENT_REQUEST_TABS,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import useAppParams from "../../../../hooks/useAppParams";
import {
  useLazyGetPaymentRequestProjectListFilterDataQuery,
  useLazyGetPaymentRequestRequestedByListFilterDataQuery,
  useLazyGetPaymentRequestVendorListFilterDataQuery,
} from "../../../../services/payment-request.service";
import { toTitleCase } from "../../../../utils/case-conversion";
import { isSearchValueExist } from "../../../../utils/common-methods";
import {
  getPaymentRequestModule,
  getPaymentRequestProjectFilterDropdownApiEndpoint,
  getPaymentRequestRequestedByFilterApiEndpoint,
  initialFilterData,
} from "../../../../utils/payment-request";
import type { IRequestTableHeaderProps } from "./interface";

const PaymentRequestTableHeader = (props: IRequestTableHeaderProps) => {
  const module = getPaymentRequestModule();
  const { projectId = "", vendorId = "", orgId: clientId = "" } = useAppParams();
  const [fetchVendorList, vendorListState] = useLazyGetPaymentRequestVendorListFilterDataQuery();
  const [fetchRequestedByList, requestedByListState] = useLazyGetPaymentRequestRequestedByListFilterDataQuery();
  const [fetchProjectList, projectListState] = useLazyGetPaymentRequestProjectListFilterDataQuery();
  const clearFilter = () => {
    props.setFilterData(initialFilterData);
  };

  const handleChange = (name: string, value?: string | Date) => {
    props.setFilterData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDueDateChange = (_: string, startDate: string, endDate: string) => {
    if (!startDate && !endDate) {
      props.setFilterData((prev) => ({ ...prev, dueDate: null }));
      return;
    }
    props.setFilterData((prev) => ({ ...prev, dueDate: { startDate, endDate } }));
  };

  const getIsFilterActive = () => {
    return !!(
      props.filterData.requestId ||
      props.filterData.requestDate ||
      props.filterData.paymentDone ||
      props.filterData.paymentDue ||
      props.filterData.requestedAmount ||
      props.filterData.requestType.id ||
      props.filterData.vendors.length ||
      props.filterData.requestedBy.length ||
      props.filterData.status ||
      props.filterData.project.length ||
      props.filterData.dueDate
    );
  };

  const getStatusFilterDropdownData = () => {
    switch (props.selectedTab) {
      case PAYMENT_REQUEST_TABS.allRequests:
        return Object.values(PAYMENT_REQUEST_STATUS);
      case PAYMENT_REQUEST_TABS.pendingRequests: {
        return [PAYMENT_REQUEST_STATUS.pending, PAYMENT_REQUEST_STATUS.hold];
      }
      case PAYMENT_REQUEST_TABS.approvedRequests:
        return [PAYMENT_REQUEST_STATUS.approved];
      default:
        return Object.values(PAYMENT_REQUEST_STATUS);
    }
  };

  return (
    <RDTableHeader className={clsx("display-grid payment-request-table-columns bg-white border-b", props.className)}>
      <RDTableHeaderIndicator
        colId="sno"
        colTitle="S.No"
        isApplied={getIsFilterActive()}
        clearFilter={clearFilter}
        alignment="center"
      />

      <RDTableHeaderDate
        colId="requestDate"
        colTitle="Request Date"
        value={props.filterData.requestDate}
        setValue={handleChange}
      />

      <RDTableHeaderSearch
        colId="requestId"
        colTitle="Request ID"
        value={props.filterData.requestId}
        handleSearch={handleChange}
      />

      {[PAYMENT_REQUEST_MODULE.manageClientPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module) && (
        <RDTableHeaderMultiSelect
          colId="projectName"
          colTitle="Project Name"
          value={props.filterData.project}
          dropDownValue={projectListState.data || []}
          dropdownClip={(item, _index, remove) => ({
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
              apiEndpoint: getPaymentRequestProjectFilterDropdownApiEndpoint(),
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
          dropdownClip={(item, _index, remove) => ({
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
          searchFilter={(item, searchText) => isSearchValueExist(searchText, item.name)}
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

      <RDTableHeaderDateV2
        colId="dueDate"
        colTitle="Due Date"
        startDate={props.filterData.dueDate?.startDate}
        endDate={props.filterData.dueDate?.endDate}
        setValue={handleDueDateChange}
      />

      <RDTableHeaderMultiSelect
        colId="requestedBy"
        colTitle="Requested by"
        value={props.filterData.requestedBy}
        dropDownValue={requestedByListState.data || []}
        dropdownClip={(item, _index, remove) => ({
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
        setValue={(value) => props.setFilterData((prev) => ({ ...prev, requestedBy: value }))}
        search={true}
        searchFilter={(item, searchText) => isSearchValueExist(searchText, item.name)}
        isLoading={requestedByListState.isLoading}
        onDropdownClick={() =>
          fetchRequestedByList({
            apiEndpoint: getPaymentRequestRequestedByFilterApiEndpoint(),
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
        dropDownValue={getStatusFilterDropdownData()}
        dropdownItem={(element, index) => ({
          key: index,
          element: <RDTableInputDropdownSelectItem>{toTitleCase(element)}</RDTableInputDropdownSelectItem>,
        })}
        dropdownLabel={(item) => item}
      />

      <RDTableHeaderSearch
        colId="requestedAmount"
        colTitle={`Requested Amount (${props.i18n.currencySymbol})`}
        value={props.filterData.requestedAmount}
        handleSearch={handleChange}
        alignment="right"
      />

      <RDTableHeaderSearch
        colId="paymentDue"
        colTitle={`Payment Due (${props.i18n.currencySymbol})`}
        value={props.filterData.paymentDue}
        handleSearch={handleChange}
        alignment="right"
      />

      {props.selectedTab !== PAYMENT_REQUEST_TABS.paymentDue && (
        <RDTableHeaderSearch
          colId="paymentDone"
          colTitle={`Payment Done (${props.i18n.currencySymbol})`}
          value={props.filterData.paymentDone}
          handleSearch={handleChange}
          alignment="right"
        />
      )}

      <div />
    </RDTableHeader>
  );
};

export default PaymentRequestTableHeader;
